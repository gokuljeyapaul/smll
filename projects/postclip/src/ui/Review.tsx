import { useEffect, useState } from 'react';
import { buildSharePayload, copyReviewText } from '../output/payload';
import type { OcrStatus } from '../App';

export interface ReviewProps {
  text: string;
  status: OcrStatus;
  imageFile: File | null;
  onTextChange: (text: string) => void;
  onStartOver: () => void;
}

export function Review({ text, status, imageFile, onTextChange, onStartOver }: ReviewProps) {
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
      <label className="review-label" htmlFor="review-text">
        Extracted text
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
        {copied ? <span className="copied-note">Copied ✓</span> : null}
      </div>
      {actionError ? (
        <div className="error-banner" role="alert">
          {actionError}
        </div>
      ) : null}
    </main>
  );
}
