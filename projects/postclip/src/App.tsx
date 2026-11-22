import { useCallback, useRef, useState } from 'react';
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
import type { OcrEngine, OcrResult } from './ocr/types';

export type OcrStatus = 'idle' | 'reading' | 'ready' | 'error';

/**
 * The S1 pipeline (plan "Architecture"):
 *   pick → sniff (non-image / tiny, before OCR) → decode (corrupt) →
 *   downscale huge → real in-browser OCR → no-text check →
 *   English-only gate → deterministic cleanup → review (editable) →
 *   share / copy / export.
 *
 * Every failure degrades to the previous safe stage with a SPECIFIC visible
 * message (A07) — never a crash, never a silently empty review. The gate
 * runs BEFORE cleanup, so a non-English screenshot is rejected with the
 * gate's message and no cleanup happens (A06).
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

  const fail = useCallback((message: string, secrets: string[] = []) => {
    setStatus('error');
    setError(redactText(message, secrets));
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
            ocrInput = await downscaleToPngBlob(bitmap, plan.width, plan.height);
          }
          bitmap.close();

          // 4. Real in-browser OCR (tesseract.js in its own worker).
          engineRef.current ??= createTesseractEngine();
          const result: OcrResult = await engineRef.current.recognize(ocrInput);
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

          // 6. Deterministic cleanup → editable review text.
          setRawText(normalized.text);
          setText(cleanupOcrText(normalized.lines).text);
          setStatus('ready');
        } catch (err) {
          if (runId !== runIdRef.current) return;
          // Fail closed: degrade to the safe previous stage with a visible flag.
          fail(`Could not read that image: ${String(err)}`);
        }
      })();
    },
    [fail],
  );

  const onStartOver = useCallback(() => {
    runIdRef.current++;
    setStatus('idle');
    setImageFile(null);
    setText('');
    setRawText('');
    setError(null);
    setNote(null);
  }, []);

  if (status === 'ready' || status === 'reading') {
    return (
      <Review
        text={text}
        rawText={rawText}
        status={status}
        note={note}
        imageFile={imageFile}
        onTextChange={setText}
        onStartOver={onStartOver}
      />
    );
  }

  return <Home status={status} error={error} onImageSelected={onImageSelected} />;
}
