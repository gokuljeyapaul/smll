import { useEffect, useState } from 'react';
import {
  buildSharePayload,
  copyReviewText,
  downloadExport,
  type ExportFormat,
  type ShareExtras,
} from '../output/payload';
import type { OcrStatus, LlmStatus, LlmSuggestions } from '../App';
import type { ModelState } from '../model/state';

export interface ReviewProps {
  text: string;
  /** The pre-cleanup OCR text, shown in the transparency view. */
  rawText: string;
  status: OcrStatus;
  /** Informational note (e.g. the huge-image downscale notice). */
  note: string | null;
  imageFile: File | null;
  /** S3 (UC09): which cleanup mode the result used — the visible "says so". */
  modelState: ModelState;
  /** S4 (A21): the model-cleanup opt-in (default off, A19). */
  llmEnabled: boolean;
  /** S4 (A21): the model-cleanup state for THIS screenshot. */
  llmStatus: LlmStatus;
  /** S4 (UC05): the guard-passed suggestions, when the model cleanup applied. */
  llmSuggestions: LlmSuggestions | null;
  onLlmToggle: (enabled: boolean) => void;
  onTextChange: (text: string) => void;
  onStartOver: () => void;
}

const EXPORT_ITEMS: { format: ExportFormat; id: string; label: string }[] = [
  { format: 'md', id: 'export-md', label: 'Markdown (.md)' },
  { format: 'txt', id: 'export-txt', label: 'Text (.txt)' },
  { format: 'json', id: 'export-json', label: 'JSON (.json)' },
];

/** The model-cleanup status line (A21's visible "says so"). */
function llmStatusMessage(status: LlmStatus): string {
  switch (status) {
    case 'running':
      return 'Tidying with the on-device model — this can take a minute.';
    case 'applied':
      return 'Model cleanup applied — every word verified against the screenshot.';
    case 'unavailable':
      return "Model cleanup couldn't run for this screenshot — showing the standard rules cleanup.";
    case 'off':
    default:
      return 'Standard rules cleanup. The tidy-up model can tidy this further if you switch it on.';
  }
}

/**
 * R2-1 (A33): the RESULT screen — the answer comes first. An image that
 * arrived (shared, pasted, picked) reads by itself (status "reading" is
 * announced politely), and the screen ends on the text with a LARGE Copy
 * button first, fully above the fold at 390×844, then Share and the
 * file-save menu, and only THEN the editable text. The model-cleanup opt-in
 * stays reachable but collapsed out of the way (#advanced-cleanup); the
 * cleanup-mode line stays visible (A13/A14's explicit fallback "says so").
 */
export function Review({
  text,
  rawText,
  status,
  note,
  imageFile,
  modelState,
  llmEnabled,
  llmStatus,
  llmSuggestions,
  onLlmToggle,
  onTextChange,
  onStartOver,
}: ReviewProps) {
  const [copied, setCopied] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // S4 (plan point 5): suggestion toggles — labelled, DEFAULT OFF, and the
  // payload excludes every suggestion until its toggle is on.
  const [includeAuthor, setIncludeAuthor] = useState(false);
  const [includeTags, setIncludeTags] = useState(false);
  const [includeSummary, setIncludeSummary] = useState(false);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  useEffect(() => {
    setCopied(false);
    setActionError(null);
  }, [text]);

  // A new screenshot resets the toggles (suggestions belong to one post).
  useEffect(() => {
    setIncludeAuthor(false);
    setIncludeTags(false);
    setIncludeSummary(false);
  }, [llmSuggestions]);

  const extras: ShareExtras | undefined = llmSuggestions
    ? {
        author: llmSuggestions.output.author,
        tags: llmSuggestions.output.tags,
        summary: llmSuggestions.output.summary,
        includeAuthor: includeAuthor && llmSuggestions.output.author !== null,
        includeTags: includeTags && llmSuggestions.output.tags.length > 0,
        includeSummary: includeSummary && llmSuggestions.output.summary !== null,
      }
    : undefined;

  const onShare = async () => {
    setActionError(null);
    try {
      await navigator.share(buildSharePayload(text, extras));
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return; // user dismissed
      setActionError(`Share failed: ${String(err)}`);
    }
  };

  const onCopy = async () => {
    setActionError(null);
    try {
      await copyReviewText(buildSharePayload(text, extras).text);
      setCopied(true);
    } catch (err) {
      setCopied(false);
      // R2-2 (A43): inside an iframe/WebView without allow="clipboard-write"
      // (or any context the engine refuses), the Copy button FALLS BACK and
      // says so — a specific, kind message with the obvious next step; it
      // never silently fails.
      if (
        err instanceof DOMException &&
        (err.name === 'NotAllowedError' || err.name === 'SecurityError')
      ) {
        setActionError(
          'Copying is blocked here — the app embedding PostClip has not allowed clipboard access. Select the text below and copy it yourself; it works the same.',
        );
      } else {
        setActionError(`Copy failed: ${String(err)}`);
      }
    }
  };

  const onExport = (format: ExportFormat) => {
    setActionError(null);
    try {
      downloadExport(text, format, extras);
    } catch (err) {
      setActionError(`Export failed: ${String(err)}`);
    }
  };

  const suggestions = llmSuggestions?.output ?? null;

  return (
    <main className="app" aria-labelledby="review-title">
      <div className="review-header">
        <h1 className="app-title" id="review-title">
          Your text
        </h1>
        <button type="button" className="link-button" onClick={onStartOver}>
          Start over
        </button>
      </div>
      {imageFile ? <p className="status">Read from: {imageFile.name}</p> : null}
      {status === 'reading' ? (
        <p className="status" role="status" data-testid="reading-progress" aria-live="polite">
          Reading the screenshot…
        </p>
      ) : null}
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
      {/* R2-1 (A33): the answer's actions come FIRST — a large primary Copy,
          then Share, then the file-save menu. Edit comes after the actions. */}
      <div className="result-actions" id="result-actions">
        <button type="button" className="btn btn-copy-primary" id="copy-btn" onClick={onCopy}>
          Copy text
        </button>
        {canShare ? (
          <button type="button" className="btn" id="share-btn" onClick={onShare}>
            Share
          </button>
        ) : null}
        <details className="export-menu" id="export-menu">
          <summary className="btn btn-secondary">Save as file (.txt / .md / .json)</summary>
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
      <label className="review-label" htmlFor="review-text">
        Text — edit anything you like
      </label>
      <textarea
        id="review-text"
        className="review-text"
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        spellCheck={false}
      />
      {/* R2-1 (A33): the model opt-in stays REACHABLE but not in the way —
          collapsed inside the advanced disclosure, never on the answer's
          path (the mock's "no model card, no toggles"). */}
      {modelState === 'ready' ? (
        <details className="advanced-cleanup" id="advanced-cleanup">
          <summary>Advanced: tidy up further with the on-device model</summary>
          <p className="llm-toggle-row">
            <label className="llm-toggle" htmlFor="llm-cleanup-toggle">
              <input
                type="checkbox"
                id="llm-cleanup-toggle"
                checked={llmEnabled}
                onChange={(e) => onLlmToggle(e.target.checked)}
              />{' '}
              Use the model to tidy this screenshot (experimental, slower)
            </label>
          </p>
        </details>
      ) : null}
      <p className="llm-status" id="llm-status" data-state={llmStatus}>
        {llmStatusMessage(llmStatus)}
      </p>
      {suggestions ? (
        <section className="llm-suggestions" id="llm-suggestions" aria-label="Model suggestions">
          <h2 className="llm-suggestions-title">From the model — checked against the screenshot</h2>
          <p className="llm-suggestions-note">
            Suggestions are optional and stay out of your shared text until you switch them on.
          </p>
          {llmSuggestions?.demoted ? (
            <p className="llm-demoted" id="llm-demoted">
              This post contains text that looks like instructions. PostClip treated it as content
              and hid every generated suggestion to be safe.
            </p>
          ) : null}
          {suggestions.author !== null ? (
            <p className="llm-field" id="llm-author-row">
              <span className="llm-field-label">Author (verified):</span>{' '}
              <span className="llm-author" id="llm-author">
                {suggestions.author}
              </span>{' '}
              <label className="llm-include">
                <input
                  type="checkbox"
                  id="llm-include-author"
                  checked={includeAuthor}
                  onChange={(e) => setIncludeAuthor(e.target.checked)}
                />{' '}
                include in Share/Copy/Export
              </label>
            </p>
          ) : null}
          {suggestions.tags.length > 0 ? (
            <p className="llm-field" id="llm-tags-row">
              <span className="llm-field-label">Suggested tags:</span>{' '}
              <span className="llm-tags" id="llm-tags">
                {suggestions.tags.map((tag) => (
                  <span className="llm-tag" key={tag}>
                    {tag}
                  </span>
                ))}
              </span>{' '}
              <label className="llm-include">
                <input
                  type="checkbox"
                  id="llm-include-tags"
                  checked={includeTags}
                  onChange={(e) => setIncludeTags(e.target.checked)}
                />{' '}
                include in Share/Copy/Export
              </label>
            </p>
          ) : null}
          {suggestions.summary !== null ? (
            <p className="llm-field" id="llm-summary-row">
              <span className="llm-field-label">Suggested summary:</span>{' '}
              <span className="llm-summary" id="llm-summary">
                {suggestions.summary}
              </span>{' '}
              <label className="llm-include">
                <input
                  type="checkbox"
                  id="llm-include-summary"
                  checked={includeSummary}
                  onChange={(e) => setIncludeSummary(e.target.checked)}
                />{' '}
                include in Share/Copy/Export
              </label>
            </p>
          ) : null}
          {suggestions.removed_chrome.length > 0 ? (
            <details className="llm-removed" id="llm-removed-chrome">
              <summary>Show what the model removed ({suggestions.removed_chrome.length} lines)</summary>
              <ul className="llm-removed-list">
                {suggestions.removed_chrome.map((entry) => (
                  <li key={entry}>{entry}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>
      ) : null}
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
