import { useCallback, useRef, useState } from 'react';
import { Home } from './ui/Home';
import { Review } from './ui/Review';
import { createTesseractEngine } from './ocr/tesseract';
import { normalizeOcrLines } from './ocr/normalize';
import type { OcrEngine, OcrResult } from './ocr/types';

export type OcrStatus = 'idle' | 'reading' | 'ready' | 'error';

export function App() {
  const [status, setStatus] = useState<OcrStatus>('idle');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const engineRef = useRef<OcrEngine | null>(null);
  const runIdRef = useRef(0);

  const onImageSelected = useCallback((file: File) => {
    const runId = ++runIdRef.current;
    setImageFile(file);
    setStatus('reading');
    setError(null);
    try {
      engineRef.current ??= createTesseractEngine();
    } catch (err) {
      setStatus('error');
      setError(`OCR engine could not start: ${String(err)}`);
      return;
    }
    engineRef.current
      .recognize(file)
      .then((result: OcrResult) => {
        if (runId !== runIdRef.current) return; // superseded by a newer pick
        const normalized = normalizeOcrLines(result.lines.map((line) => line.text));
        if (normalized.text.length === 0) {
          // Fail closed: an image that produced no text is an error, never a
          // silently empty review (full bad-input matrix lands with S1/A07).
          setStatus('error');
          setError('Could not read any text from that image.');
          return;
        }
        setText(normalized.text);
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (runId !== runIdRef.current) return;
        // Fail closed: degrade to the safe previous stage with a visible flag.
        setStatus('error');
        setError(`Could not read that image: ${String(err)}`);
      });
  }, []);

  const onStartOver = useCallback(() => {
    runIdRef.current++;
    setStatus('idle');
    setImageFile(null);
    setText('');
    setError(null);
  }, []);

  if (status === 'ready' || status === 'reading') {
    return (
      <Review
        text={text}
        status={status}
        imageFile={imageFile}
        onTextChange={setText}
        onStartOver={onStartOver}
      />
    );
  }

  return <Home status={status} error={error} onImageSelected={onImageSelected} />;
}
