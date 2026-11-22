import { useEffect, useRef, useState, type DragEvent } from 'react';
import type { OcrStatus } from '../App';
import { ModelStatusCard } from './ModelStatusCard';
import {
  CLIPBOARD_UNAVAILABLE_MESSAGE,
  clipboardPermissionHint,
  clipboardReadErrorMessage,
  imageFileFromClipboardRead,
} from '../ingest/route';

export interface HomeProps {
  status: OcrStatus;
  error: string | null;
  /** S3 (UC08/UC09): the model download card's trigger. */
  onModelDownload: () => void;
  onImageSelected: (file: File) => void;
  /** UC12: shows the specific clipboard explanation (never touches the pipeline). */
  onClipboardError: (message: string) => void;
}

const CLIPBOARD_NO_IMAGE_MESSAGE =
  'No screenshot found on the clipboard. Copy a screenshot first, or add one with the Choose screenshot button below.';

export function Home({ status, error, onModelDownload, onImageSelected, onClipboardError }: HomeProps) {
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
      <ModelStatusCard onDownload={onModelDownload} />
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
      <p className="privacy-note">
        Everything happens on this device. Nothing is uploaded, stored, or sent anywhere.
      </p>
    </main>
  );
}
