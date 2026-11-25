import { useEffect, useRef, useState, type DragEvent } from 'react';
import type { OcrStatus } from '../App';
import type { ModelState } from '../model/state';
import { ModelStatusCard } from './ModelStatusCard';
import {
  CLIPBOARD_UNAVAILABLE_MESSAGE,
  clipboardPermissionHint,
  clipboardReadErrorMessage,
  imageFileFromClipboardRead,
} from '../ingest/route';

export interface HomeProps {
  status: OcrStatus;
  /** A34/A36: the kind-error message for the last failed read (if any). */
  error: string | null;
  /** A36: the ONE obvious next step shown under a kind error. */
  errorNextStep: string | null;
  /** UC12: the clipboard explanation (never touches the pipeline). */
  clipboardNotice: string | null;
  /** S3 (UC08/UC09): the model download card's trigger. */
  onModelDownload: () => void;
  onImageSelected: (file: File) => void;
  /** UC12: shows the specific clipboard explanation (never touches the pipeline). */
  onClipboardError: (message: string) => void;
  /** S4 (A21): the model-cleanup opt-in is offered on the HOME screen once
   *  the tidy-up model is ready — the user opts in BEFORE picking (the same
   *  toggle also lives, collapsed, on the result screen for the next pick). */
  modelState: ModelState;
  llmEnabled: boolean;
  onLlmToggle: (enabled: boolean) => void;
}

const CLIPBOARD_NO_IMAGE_MESSAGE =
  'No screenshot found on the clipboard. Copy a screenshot first, or add one with the Choose screenshot button below.';

export function Home({
  status,
  error,
  errorNextStep,
  clipboardNotice,
  onModelDownload,
  onImageSelected,
  onClipboardError,
  modelState,
  llmEnabled,
  onLlmToggle,
}: HomeProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [permissionHint, setPermissionHint] = useState<string | null>(null);
  const canReadClipboard =
    typeof navigator !== 'undefined' && typeof navigator.clipboard?.read === 'function';

  // UC12: where the permission is queryable and known-DENIED, the Paste
  // button explains itself up front (Chromium can query clipboard-read;
  // engines that cannot query it show nothing proactively and still explain
  // on click — fail closed either way).
  useEffect(() => {
    let cancelled = false;
    try {
      navigator.permissions
        ?.query({ name: 'clipboard-read' as PermissionName })
        .then((p) => {
          if (!cancelled) setPermissionHint(clipboardPermissionHint(p.state));
        })
        .catch(() => {});
    } catch {
      // not queryable in this engine — no proactive hint
    }
    return () => {
      cancelled = true;
    };
  }, []);

  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragOver(false);
    const file = event.dataTransfer.files?.[0];
    if (file) onImageSelected(file);
  };

  const onDragOver = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragOver(true);
  };

  const onDragLeave = () => setDragOver(false);

  const onInputChange = (files: FileList | null) => {
    const file = files?.[0];
    if (file) onImageSelected(file);
  };

  // UC03/UC12: the Paste button reads the REAL clipboard; every failure gets
  // its specific, kind message naming the still-working file picker.
  const onPasteClick = async () => {
    if (!canReadClipboard) {
      onClipboardError(CLIPBOARD_UNAVAILABLE_MESSAGE);
      return;
    }
    try {
      const items = await navigator.clipboard.read();
      const file = await imageFileFromClipboardRead(items);
      if (file) {
        onImageSelected(file);
      } else {
        onClipboardError(CLIPBOARD_NO_IMAGE_MESSAGE);
      }
    } catch (err) {
      onClipboardError(clipboardReadErrorMessage(err));
    }
  };

  return (
    <main className="app" aria-labelledby="app-title">
      <header className="app-header">
        <h1 className="app-title" id="app-title">
          PostClip
        </h1>
      </header>
      <p className="app-tagline">
        Turn a screenshot of a post into clean text you can edit and share.
      </p>
      <div
        className={`dropzone${dragOver ? ' dragover' : ''}`}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        data-testid="dropzone"
      >
        <p className="dropzone-hint">Drop a screenshot here, paste it, or</p>
        <button type="button" className="btn" onClick={() => inputRef.current?.click()}>
          Choose screenshot
        </button>
        {canReadClipboard ? (
          <>
            <span className="dropzone-or">or</span>
            <button
              type="button"
              className="btn btn-secondary"
              id="paste-btn"
              onClick={() => void onPasteClick()}
            >
              Paste from clipboard
            </button>
          </>
        ) : null}
        <input
          ref={inputRef}
          id="file-input"
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => onInputChange(e.target.files)}
        />
      </div>
      {/* R2-3 (A40, issue #78): the 397 MB download is OPT-IN — it lives only
          inside the collapsed "Advanced: optional tidy-up model" section,
          never as a front-page card. Fail states (unsupported/failed) stay
          visible outside the section (the explicit fallback "says so");
          cached means READY, VISIBLY: a small state line, never the
          download button. */}
      {modelState === 'ready' ? (
        <p className="model-ready" id="model-ready">
          Tidy-up model ready (cached) — tidier cleanup, and it works offline.
        </p>
      ) : modelState === 'failed' || modelState === 'unsupported' ? (
        <ModelStatusCard onDownload={onModelDownload} />
      ) : (
        <details className="advanced-model" id="advanced-model">
          <summary>Advanced: optional tidy-up model</summary>
          <ModelStatusCard onDownload={onModelDownload} />
        </details>
      )}
      {modelState === 'ready' ? (
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
      ) : null}
      {permissionHint ? (
        <p className="status" id="clipboard-permission-hint">
          {permissionHint}
        </p>
      ) : null}
      {status === 'reading' ? <p className="status">Reading the screenshot…</p> : null}
      {error ? (
        <div className="error-banner" role="alert">
          {error}
        </div>
      ) : null}
      {error && errorNextStep ? (
        <p className="status" id="error-next-step">
          {errorNextStep}
        </p>
      ) : null}
      {clipboardNotice ? (
        <div className="error-banner" role="alert">
          {clipboardNotice}
        </div>
      ) : null}
      <p className="privacy-note">
        Everything happens on this device. Nothing is uploaded, stored, or sent anywhere.
      </p>
    </main>
  );
}
