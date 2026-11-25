import { useCallback, useEffect, useRef, useState } from 'react';
import { Home } from './ui/Home';
import { Review } from './ui/Review';
import { createTesseractEngine } from './ocr/tesseract';
import { normalizeOcrLines } from './ocr/normalize';
import { cleanupOcrText } from './cleanup/cleanup';
import { detectEnglish } from './language/gate';
import {
  DOWNSCALE_NOTE,
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
import {
  INITIAL_ARRIVAL_STATE,
  KIND_ERROR_NEXT_STEPS,
  kindErrorMessage,
  nextArrivalState,
  type ArrivalEvent,
  type ArrivalState,
  type KindErrorReason,
} from './flow/arrival';
import {
  HOST_ALLOWLIST_ENV,
  HOST_ALLOWLIST_PARAM,
  createHostBridge,
  hostAllowList,
  type HostBridge,
} from './host/messaging';

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
 * The pipeline (plan "Architecture"), R2-1 share-first:
 *   share-target / paste / pick → sniff → decode → downscale →
 *   real in-browser OCR → no-text check → English-only gate →
 *   deterministic cleanup → RESULT (text with Copy first, then
 *   Share/Save, then Edit) → share / copy / export.
 *
 * R2-1 (A34): the screen flow is driven by the arrival state machine —
 * arrived → reading → result | kind error — pure logic in src/flow/arrival
 * (unit-tested there). An image that ARRIVES starts reading by itself, with
 * one clear progress state, and the screen ends on the text with a large
 * Copy button first; a failure lands on its specific kind error plus one
 * obvious next step (A36).
 */
export function App() {
  const [arrival, setArrival] = useState<ArrivalState>(INITIAL_ARRIVAL_STATE);
  const [clipboardNotice, setClipboardNotice] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [text, setText] = useState(''); // the CLEANED, editable result text
  const [rawText, setRawText] = useState(''); // pre-cleanup OCR (transparency view)
  const [note, setNote] = useState<string | null>(null);
  const engineRef = useRef<OcrEngine | null>(null);
  const runIdRef = useRef(0);
  // R2-2 (A44/A45): the host bridge — installed ONLY when the app is
  // embedded AND the origin allow-list is non-empty (default: empty, so
  // standalone usage is byte-for-byte unchanged). hostRequestIdRef tracks
  // which host request owns the in-flight read, so the result (or the kind
  // error) goes back to the host with the right correlation id.
  const hostBridgeRef = useRef<HostBridge | null>(null);
  const hostRequestIdRef = useRef<string | null>(null);
  const [modelProgress, setModelProgress] = useState<ModelProgress>(modelManager.getStatus());
  const [llmEnabled, setLlmEnabled] = useState(LLM_CLEANUP_ENABLED_BY_DEFAULT);
  const llmEnabledRef = useRef(LLM_CLEANUP_ENABLED_BY_DEFAULT);
  const [llmStatus, setLlmStatus] = useState<LlmStatus>('off');
  const [llmSuggestions, setLlmSuggestions] = useState<LlmSuggestions | null>(null);

  // A34: every screen change goes through the pure machine.
  const dispatch = useCallback((event: ArrivalEvent) => {
    setArrival((state) => nextArrivalState(state, event));
  }, []);

  /** A36: the kind-error surface — the specific message for the reason,
   * plus its ONE obvious next step. */
  const fail = useCallback((reason: KindErrorReason, detail?: string) => {
    setArrival((state) => nextArrivalState(state, { type: 'read-failed', reason, detail }));
    // R2-2 (A45): a host-handed read reports its kind failure back with
    // the exact reason as the postclip:error code (same strings as the UI).
    const requestId = hostRequestIdRef.current;
    if (requestId) hostBridgeRef.current?.reportError(requestId, reason);
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
      // R2-2 (A45): a new manual arrival supersedes any pending host
      // request — the host handler re-claims the pipeline after this reset.
      hostRequestIdRef.current = null;
      setImageFile(file);
      setNote(null);
      setRawText('');
      setText('');
      setClipboardNotice(null);
      setLlmStatus('off');
      setLlmSuggestions(null);
      // R2-1 (A32/A34): the arrival starts reading BY ITSELF — the machine
      // moves to the reading phase (one clear progress state) with no
      // extra tap, from any channel (share, paste, pick).
      dispatch({ type: 'image-arrived' });

      void (async () => {
        try {
          // 1. Byte-level sniff, BEFORE any OCR: non-image and tiny inputs
          //    fail fast with their specific messages (A07).
          const head = new Uint8Array(await file.slice(0, 65536).arrayBuffer());
          const header = sniffImageHeader(head);
          if (!header) {
            fail('non-image');
            return;
          }
          if (Math.min(header.width, header.height) < MIN_IMAGE_DIM) {
            fail('tiny');
            return;
          }

          // 2. Full decode catches truncated streams (corrupt01.png has a
          //    valid PNG header and a garbage stream).
          performance.mark('postclip:decode-start');
          let bitmap: ImageBitmap;
          try {
            bitmap = await createImageBitmap(file);
          } catch {
            fail('corrupt');
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
            // error state, never a silently empty screen (A07).
            fail('no-text');
            return;
          }

          // 5. English-only gate, BEFORE cleanup: a non-English screenshot
          //    is rejected with a clear message and nothing further runs (A06).
          const verdict = detectEnglish(normalized.text);
          if (!verdict.isEnglish) {
            fail('non-english');
            return;
          }

          // 6. Deterministic cleanup → the RESULT text (R2-1: the screen
          //    shows the answer first — Copy, Share/Save, then Edit). The
          //    model path is a progressive upgrade, never a dependency (D8).
          performance.mark('postclip:cleanup-start');
          const deterministic = cleanupOcrText(normalized.lines);
          performance.mark('postclip:cleanup-end');
          performance.measure('postclip:cleanup', 'postclip:cleanup-start', 'postclip:cleanup-end');
          setRawText(normalized.text);
          setText(deterministic.text);
          dispatch({ type: 'read-ok' });
          setLlmSuggestions(null);
          setLlmStatus('off');
          // R2-2 (A45): the host gets the text the moment the standard read
          // lands (the last postclip:result for a requestId wins — a model
          // upgrade later sends the updated text the same way).
          const hostRequestId = hostRequestIdRef.current;
          if (hostRequestId) hostBridgeRef.current?.reportResult(hostRequestId, deterministic.text);

          // 7. S4 model cleanup (A19: OFF by default; the user opted in):
          //    runs in the Worker on the cached weights, goes through the
          //    deterministic validator + faithfulness guard, and REPLACES
          //    the result text only when it passed. Any failure leaves
          //    the deterministic result with an explicit visible flag —
          //    unvalidated model text is never shown (plan point 4).
          if (llmEnabledRef.current && modelManager.getStatus().state === 'ready') {
            setLlmStatus('running');
            const { outcome } = await llmCleanupClient.cleanup(normalized.lines);
            if (runId !== runIdRef.current) return; // superseded by a newer pick
            if (outcome.kind === 'model') {
              setText(outcome.output.body);
              // R2-2 (A45): the upgraded text replaces the standard result
              // for the host too (the last postclip:result wins).
              if (hostRequestId) {
                hostBridgeRef.current?.reportResult(hostRequestId, outcome.output.body);
              }
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
          fail('unreadable', String(err));
        }
      })();
    },
    [dispatch, fail],
  );

  // R2-2 (A44/A45): the host bridge — postclip:load-image from an
  // allow-listed origin enters the SAME arrival pipeline as a pick. The
  // bridge installs nothing standalone (empty allow-list) or at top level,
  // and it never logs message content (A15's rules are unchanged).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const env = import.meta.env as unknown as Record<string, string | undefined>;
    const allowList = hostAllowList(env[HOST_ALLOWLIST_ENV], params.get(HOST_ALLOWLIST_PARAM));
    const bridge = createHostBridge({
      allowList,
      handlers: {
        onLoadImage: (file, requestId) => {
          onImageSelected(file); // resets the pending-host ref synchronously…
          hostRequestIdRef.current = requestId; // …then this load owns the pipeline
        },
      },
    });
    hostBridgeRef.current = bridge;
    return () => {
      bridge?.destroy();
      hostBridgeRef.current = null;
    };
  }, [onImageSelected]);

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
    setClipboardNotice(message);
  }, []);

  const onStartOver = useCallback(() => {
    runIdRef.current++;
    hostRequestIdRef.current = null;
    dispatch({ type: 'reset' });
    setImageFile(null);
    setText('');
    setRawText('');
    setNote(null);
    setLlmStatus('off');
    setLlmSuggestions(null);
  }, [dispatch]);

  const modelState: ModelState = modelProgress.state;

  // A34: the machine's phases map onto the screen states the UI renders.
  const status: OcrStatus =
    arrival.phase === 'reading'
      ? 'reading'
      : arrival.phase === 'result'
        ? 'ready'
        : arrival.phase === 'kind-error'
          ? 'error'
          : 'idle';

  // A34/A36: the kind-error surface — the specific message for the reason,
  // redacted, plus the ONE obvious next step.
  const error =
    arrival.phase === 'kind-error' && arrival.error
      ? redactText(kindErrorMessage(arrival.error), [])
      : null;
  const errorNextStep =
    arrival.phase === 'kind-error' && arrival.error ? KIND_ERROR_NEXT_STEPS[arrival.error.reason] : null;

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
      errorNextStep={errorNextStep}
      clipboardNotice={clipboardNotice}
      onModelDownload={onModelDownload}
      onImageSelected={onImageSelected}
      onClipboardError={onClipboardError}
      modelState={modelState}
      llmEnabled={llmEnabled}
      onLlmToggle={onLlmToggle}
    />
  );
}
