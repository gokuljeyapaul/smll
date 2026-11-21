import { createWorker, type Worker as TesseractWorker } from 'tesseract.js';
import type { OcrEngine, OcrResult } from './types';

/**
 * The Tesseract.js OCR engine (chosen by measurement in S0 — see
 * docs/evidence/S0/ocr_engine_comparison.md).
 *
 * Runs inside the browser: `createWorker` spawns tesseract.js's own dedicated
 * Web Worker (served same-origin from /ocr-assets/), and the WASM core and
 * English traineddata load from the same origin — no third-party CDN, no
 * upload. All inference happens in that worker, off the UI thread, which is
 * the requirement the plan puts on any OcrEngine implementation.
 */
export function createTesseractEngine(): OcrEngine {
  let workerPromise: Promise<TesseractWorker> | null = null;

  async function getWorker(): Promise<TesseractWorker> {
    if (!workerPromise) {
      workerPromise = createWorker('eng', 1, {
        workerPath: '/ocr-assets/worker.min.js',
        corePath: '/ocr-assets/',
        langPath: '/ocr-assets/',
        workerBlobURL: false,
        // Failures already surface as a rejected recognize() promise, which the
        // app turns into a visible error (fail closed). Without this handler
        // tesseract.js ALSO throws the same error unhandled inside its message
        // loop, producing a stray page error on top of the handled one.
        errorHandler: () => {},
      });
    }
    return workerPromise;
  }

  return {
    name: 'tesseract.js',
    async recognize(image: Blob): Promise<OcrResult> {
      const worker = await getWorker();
      const { data } = await worker.recognize(image, {}, { text: true, blocks: true });
      const lines = (data.blocks ?? [])
        .flatMap((block) => block.paragraphs ?? [])
        .flatMap((paragraph) => paragraph.lines ?? [])
        .map((line) => ({ text: line.text, confidence: line.confidence }));
      return { text: data.text, lines };
    },
  };
}
