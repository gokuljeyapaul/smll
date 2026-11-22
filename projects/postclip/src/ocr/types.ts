/** A single OCR-recognized line. */
export interface OcrLine {
  text: string;
  confidence: number;
}

/** The raw output of one OCR run over one image. */
export interface OcrResult {
  text: string;
  lines: OcrLine[];
}

/**
 * An OCR engine. Implementations wrap a real in-browser OCR backend and must
 * do their heavy work off the UI thread (a Worker, directly or via the
 * backend's own worker) so the UI stays responsive.
 */
export interface OcrEngine {
  readonly name: string;
  recognize(image: Blob): Promise<OcrResult>;
}

export type OcrEngineFactory = () => OcrEngine;
