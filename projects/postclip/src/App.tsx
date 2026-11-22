import { useCallback, useEffect, useRef, useState } from 'react';
import { Home } from './ui/Home';
import { Review } from './ui/Review';
import { createTesseractEngine } from './ocr/tesseract';
import { normalizeOcrLines, NO_TEXT_MESSAGE } from './ocr/normalize';
import { cleanupOcrText } from './cleanup/cleanup';
import { detectEnglish, NON_ENGLISH_MESSAGE } from './language/gate';
import {
  DOWNSCALE_NOTE,
  ERROR_MESSAGES,
  MIN_IMAGE_DIM,
  downscaleToPngBlob,
  planDownscale,
  sniffImageHeader,
} from './image/validate';
import { redactText } from './privacy/audit';
import { modelManager, type ModelProgress } from './model/manager';
import type { ModelState } from './model/state';
import {
  imageFileFromDataTransferFiles,
  shareTargetFileFromMessage,
} from './ingest/route';
import type { OcrEngine, OcrResult } from './ocr/types';
import { llmCleanupClient } from './cleanup/llm/client';
import type { LlmCleanupOutput } from './cleanup/llm/schema';
import { LLM_CLEANUP_ENABLED_BY_DEFAULT } from './cleanup/llm/config';

export type OcrStatus = 'idle' | 'reading' | 'ready' | 'error';

/** The model-cleanup UI state (S4 — A19: disabled by default; the user
 *  opts in per session; nothing persists — the storage allow-list has no
 *  room for a settings flag, and a reset-on-reload default is the safe
 *  side of the A19 decision). */
export type LlmStatus = 'off' | 'running' | 'applied' | 'unavailable';

export interface LlmSuggestions {
  output: LlmCleanupOutput;
  demoted: boolean;
}

/**
 * The S2 pipeline (plan "Architecture"):
 *   paste / share-target / pick → sniff → decode → downscale →
 *   real in-browser OCR → no-text check → English-only gate →
 *   deterministic cleanup → review (editable) → share / copy / export.
 *
 * S2 adds two input channels on top of S1's picker/drop (both fail closed
 * exactly like a pick — every error degrades to the previous safe stage
 * with a specific visible message):
 *   - UC03: a paste event carrying an image file (Ctrl/Cmd+V), at document
 *     level so it works on every screen; text-only pastes are never
 *     hijacked (the review textarea keeps working normally);
 *   - UC02: an image shared into the installed app, delivered by the
 *     service worker as a message (the worker never stores it).
 */
export function App() {
  const [status, setStatus] = useState<OcrStatus>('idle');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [text, setText] = useState(''); // the CLEANED, editable review text
  const [rawText, setRawText] = useState(''); // pre-cleanup OCR (transparency view)
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const engineRef = useRef<OcrEngine | null>(null);
  const runIdRef = useRef(0);
  const [modelProgress, setModelProgress] = useState<ModelProgress>(modelManager.getStatus());
  const [llmEnabled, setLlmEnabled] = useState(LLM_CLEANUP_ENABLED_BY_DEFAULT);
  const llmEnabledRef = useRef(LLM_CLEANUP_ENABLED_BY_DEFAULT);
  const [llmStatus, setLlmStatus] = useState<LlmStatus>('off');
  const [llmSuggestions, setLlmSuggestions] = useState<LlmSuggestions | null>(null);

  const fail = useCallback((message: string, secrets: string[] = []) => {
    setStatus('error');
    setError(redactText(message, secrets));
  }, []);

  // S3 (UC08/UC09/UC14): the model manager runs beside the pipeline —
  // capability probe + cache check on mount (never network), live progress
  // while downloading, and a fail-closed state the UI turns into the
  // explicit fallback banner. The pipeline never depends on it.
  useEffect(() => {
    const unsubscribe = modelManager.subscribe(setModelProgress);
    void modelManager.check();
    return unsubscribe;
  }, []);

  const onModelDownload = useCallback(() => {
    void modelManager.download();
  }, []);

  // S4 (A19/A21): the user opts into the model cleanup for this session.
  // The opt-in applies to the NEXT pick (the current text already has a
  // cleanup; re-running it silently would swap text under the user's
  // cursor mid-edit). Nothing persists (see the state declaration).
  const onLlmToggle = useCallback((enabled: boolean) => {
    llmEnabledRef.current = enabled;
    setLlmEnabled(enabled);
    if (!enabled) {
      setLlmStatus('off');
      setLlmSuggestions(null);
    }
  }, []);

  const onImageSelected = useCallback(
    (file: File) => {
      const runId = ++runIdRef.current;
      setImageFile(file);
      setStatus('reading');
      setError(null);
      setNote(null);
      setRawText('');
      setText('');
      setLlmStatus('off');
      setLlmSuggestions(null);

      void (async () => {
        try {
          // 1. Byte-level sniff, BEFORE any OCR: non-image and tiny inputs
          //    fail fast with their specific messages (A07).
          const head = new Uint8Array(await file.slice(0, 65536).arrayBuffer());
          const header = sniffImageHeader(head);
          if (!header) {
            fail(ERROR_MESSAGES['non-image']);
            return;
          }
          if (Math.min(header.width, header.height) < MIN_IMAGE_DIM) {
            fail(ERROR_MESSAGES.tiny);
            return;
          }

          // 2. Full decode catches truncated streams (corrupt01.png has a
          //    valid PNG header and a garbage stream).
          performance.mark('postclip:decode-start');
          let bitmap: ImageBitmap;
          try {
            bitmap = await createImageBitmap(file);
          } catch {
            fail(ERROR_MESSAGES.corrupt);
            return;
          }

          // 3. Huge images are downscaled before OCR (A07); normal
          //    screenshots pass through untouched.
          let ocrInput: Blob = file;
          const plan = planDownscale(header.width, header.height);
          if (plan.needed) {
            setNote(DOWNSCALE_NOTE);
            performance.mark('postclip:downscale-start');
            ocrInput = await downscaleToPngBlob(bitmap, plan.width, plan.height);
            performance.mark('postclip:downscale-end');
            performance.measure('postclip:downscale', 'postclip:downscale-start', 'postclip:downscale-end');
          }
          performance.mark('postclip:decode-end');
          performance.measure('postclip:decode', 'postclip:decode-start', 'postclip:decode-end');
          bitmap.close();

          // 4. Real in-browser OCR (tesseract.js in its own worker).
          //    The user Timing marks are the A22 measurement surface
          //    (headless-Linux numbers; the eval reads postclip:ocr).
          engineRef.current ??= createTesseractEngine();
          performance.mark('postclip:ocr-start');
          const result: OcrResult = await engineRef.current.recognize(ocrInput);
          performance.mark('postclip:ocr-end');
          performance.measure('postclip:ocr', 'postclip:ocr-start', 'postclip:ocr-end');
          if (runId !== runIdRef.current) return; // superseded by a newer pick

          const normalized = normalizeOcrLines(result.lines.map((line) => line.text));
          if (normalized.text.length === 0) {
            // Fail closed: an image with no readable text is a specific
            // error state, never a silently empty review (A07).
            fail(NO_TEXT_MESSAGE);
            return;
          }

          // 5. English-only gate, BEFORE cleanup: a non-English screenshot
          //    is rejected with a clear message and nothing further runs (A06).
          const verdict = detectEnglish(normalized.text);
          if (!verdict.isEnglish) {
            fail(NON_ENGLISH_MESSAGE);
            return;
          }

          // 6. Deterministic cleanup → editable review text (always shown
          //    first: the model path is a progressive upgrade, never a
          //    dependency — D8). The mark is the A22 measurement surface for
          //    the DEFAULT cleanup path (the opt-in LLM path's numbers are
          //    recorded by the S4 eval; it ships disabled by default).
          performance.mark('postclip:cleanup-start');
          const deterministic = cleanupOcrText(normalized.lines);
          performance.mark('postclip:cleanup-end');
          performance.measure('postclip:cleanup', 'postclip:cleanup-start', 'postclip:cleanup-end');
          setRawText(normalized.text);
          setText(deterministic.text);
          setStatus('ready');
          setLlmSuggestions(null);
          setLlmStatus('off');

          // 7. S4 model cleanup (A19: OFF by default; the user opted in):
          //    runs in the Worker on the cached weights, goes through the
          //    deterministic validator + faithfulness guard, and REPLACES
          //    the review text only when it passed. Any failure leaves
          //    the deterministic result with an explicit visible flag —
          //    unvalidated model text is never shown (plan point 4).
          if (llmEnabledRef.current && modelManager.getStatus().state === 'ready') {
            setLlmStatus('running');
            const { outcome } = await llmCleanupClient.cleanup(normalized.lines);
            if (runId !== runIdRef.current) return; // superseded by a newer pick
            if (outcome.kind === 'model') {
              setText(outcome.output.body);
              setLlmSuggestions({ output: outcome.output, demoted: outcome.validation.demoted ?? false });
              setLlmStatus('applied');
            } else {
              setLlmStatus('unavailable');
            }
            if (__POSTCLIP_TEST_BUILD__) {
              // Test-build-only debug record (A29: eliminated from the
              // production bundle): the eval reads the raw model text and
              // the guard verdict as evidence. Never user-facing.
              (window as unknown as Record<string, unknown>).__postclipLlmDebug = {
                mode: outcome.kind === 'model' ? 'applied' : 'unavailable',
                modelText: outcome.kind === 'model' ? outcome.output.body : null,
                rawModelText: outcome.kind === 'fallback' ? outcome.rawModelText ?? null : null,
                guardVerdict: outcome.kind === 'model' ? 'pass' : `reject:${outcome.reason}`,
                fallbackReason: outcome.kind === 'fallback' ? outcome.reason : null,
                author: outcome.kind === 'model' ? outcome.output.author : null,
                tags: outcome.kind === 'model' ? outcome.output.tags : [],
                summary: outcome.kind === 'model' ? outcome.output.summary : null,
                removedChrome: outcome.kind === 'model' ? outcome.output.removed_chrome : [],
                latencyMs: outcome.latencyMs,
                attempts: outcome.kind === 'model' ? outcome.attempts : 0,
                deterministicText: deterministic.text,
              };
            }
          } else if (__POSTCLIP_TEST_BUILD__) {
            (window as unknown as Record<string, unknown>).__postclipLlmDebug = {
              mode: 'off',
              modelText: null,
              rawModelText: null,
              guardVerdict: null,
              fallbackReason: null,
              author: null,
              tags: [],
              summary: null,
              removedChrome: [],
              latencyMs: 0,
              attempts: 0,
              deterministicText: deterministic.text,
            };
          }
        } catch (err) {
          if (runId !== runIdRef.current) return;
          // Fail closed: degrade to the safe previous stage with a visible flag.
          fail(`Could not read that image: ${String(err)}`);
        }
      })();
    },
    [fail],
  );

  // UC03 (S2): Ctrl/Cmd+V with an image on the clipboard routes it into the
  // same pipeline as a pick, from any screen. A paste carrying no image file
  // is ignored — the review textarea's normal text pasting keeps working.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files ?? []);
      const file = imageFileFromDataTransferFiles(files);
      if (file) {
        event.preventDefault();
        onImageSelected(file);
      }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [onImageSelected]);

  // UC02 (S2): the service worker hands over an image shared into the
  // installed app. shareTargetFileFromMessage fails closed on anything that
  // is not exactly a well-formed share-image message.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      const file = shareTargetFileFromMessage(event.data);
      if (file) onImageSelected(file);
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [onImageSelected]);

  // UC12 (S2): the clipboard explanations live on the Home screen; a failed
  // clipboard read shows the specific message without touching the pipeline.
  const onClipboardError = useCallback((message: string) => {
    setError(message);
  }, []);

  const onStartOver = useCallback(() => {
    runIdRef.current++;
    setStatus('idle');
    setImageFile(null);
    setText('');
    setRawText('');
    setError(null);
    setNote(null);
    setLlmStatus('off');
    setLlmSuggestions(null);
  }, []);

  const modelState: ModelState = modelProgress.state;

  if (status === 'ready' || status === 'reading') {
    return (
      <Review
        text={text}
        rawText={rawText}
        status={status}
        note={note}
        imageFile={imageFile}
        modelState={modelState}
        llmEnabled={llmEnabled}
        llmStatus={llmStatus}
        llmSuggestions={llmSuggestions}
        onLlmToggle={onLlmToggle}
        onTextChange={setText}
        onStartOver={onStartOver}
      />
    );
  }

  return (
    <Home
      status={status}
      error={error}
      onModelDownload={onModelDownload}
      onImageSelected={onImageSelected}
      onClipboardError={onClipboardError}
      modelState={modelState}
      llmEnabled={llmEnabled}
      onLlmToggle={onLlmToggle}
    />
  );
}
