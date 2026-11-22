import { useEffect, useState } from 'react';
import {
  buildSharePayload,
  copyReviewText,
  downloadExport,
  type ExportFormat,
} from '../output/payload';
import type { OcrStatus } from '../App';
import type { ModelState } from '../model/state';

export interface ReviewProps {
  text: string;
  /** The pre-cleanup OCR text, shown in the transparency view. */
  rawText: string;
  status: OcrStatus;
  /** Informational note (e.g. the huge-image downscale notice). */
  note: string | null;
  imageFile: File | null;
  /** S3 (UC09): which cleanup mode the review used — the visible "says so". */
  modelState: ModelState;
  onTextChange: (text: string) => void;
  onStartOver: () => void;
}

const EXPORT_ITEMS: { format: ExportFormat; id: string; label: string }[] = [
  { format: 'md', id: 'export-md', label: 'Export as Markdown (.md)' },
  { format: 'txt', id: 'export-txt', label: 'Export as Text (.txt)' },
  { format: 'json', id: 'export-json', label: 'Export as JSON (.json)' },
];

export function Review({ text, rawText, status, note, imageFile, modelState, onTextChange, onStartOver }: ReviewProps) {
  const [copied, setCopied] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  useEffect(() => {
    setCopied(false);
    setActionError(null);
  }, [text]);

  const onShare = async () => {
    setActionError(null);
    try {
      await navigator.share(buildSharePayload(text));
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return; // user dismissed
      setActionError(`Share failed: ${String(err)}`);
    }
  };

  const onCopy = async () => {
    setActionError(null);
    try {
      await copyReviewText(text);
      setCopied(true);
    } catch (err) {
      setCopied(false);
      setActionError(`Copy failed: ${String(err)}`);
    }
  };

  const onExport = (format: ExportFormat) => {
    setActionError(null);
    try {
      downloadExport(text, format);
    } catch (err) {
      setActionError(`Export failed: ${String(err)}`);
    }
  };

  return (
    <main className="app" aria-labelledby="review-title">
      <div className="review-header">
        <h1 className="app-title" id="review-title">
          Review
        </h1>
        <button type="button" className="link-button" onClick={onStartOver}>
          Start over
        </button>
      </div>
      {imageFile ? <p className="status">Read from: {imageFile.name}</p> : null}
      {status === 'reading' ? <p className="status">Reading the screenshot…</p> : null}
      {note ? (
        <p className="status" id="downscale-note">
          {note}
        </p>
      ) : null}
      <p className="cleanup-mode" id="cleanup-mode">
        {modelState === 'ready'
          ? 'Tidy-up model ready — tidier cleanup, works offline.'
          : "Standard cleanup — the tidy-up model isn't set up on this device."}
      </p>
      <label className="review-label" htmlFor="review-text">
        Cleaned text — edit anything you like
      </label>
      <textarea
        id="review-text"
        className="review-text"
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        spellCheck={false}
      />
      <div className="actions">
        {canShare ? (
          <button type="button" className="btn" id="share-btn" onClick={onShare}>
            Share
          </button>
        ) : null}
        <button type="button" className="btn btn-secondary" id="copy-btn" onClick={onCopy}>
          Copy
        </button>
        <details className="export-menu" id="export-menu">
          <summary className="btn btn-secondary">Export</summary>
          <div className="export-items" role="menu">
            {EXPORT_ITEMS.map((item) => (
              <button
                key={item.format}
                type="button"
                role="menuitem"
                className="export-item"
                id={item.id}
                onClick={() => onExport(item.format)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </details>
        {copied ? <span className="copied-note">Copied ✓</span> : null}
      </div>
      {rawText ? (
        <details className="raw-ocr">
          <summary>Show original OCR text (before cleanup)</summary>
          <pre id="raw-ocr-text" className="raw-ocr-text">
            {rawText}
          </pre>
        </details>
      ) : null}
      {actionError ? (
        <div className="error-banner" role="alert">
          {actionError}
        </div>
      ) : null}
    </main>
  );
}
