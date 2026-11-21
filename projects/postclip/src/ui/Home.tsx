import { useRef, useState, type DragEvent } from 'react';
import type { OcrStatus } from '../App';

export interface HomeProps {
  status: OcrStatus;
  error: string | null;
  onImageSelected: (file: File) => void;
}

export function Home({ status, error, onImageSelected }: HomeProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

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
        <p className="dropzone-hint">Drop a screenshot here, or</p>
        <button type="button" className="btn" onClick={() => inputRef.current?.click()}>
          Choose screenshot
        </button>
        <input
          ref={inputRef}
          id="file-input"
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => onInputChange(e.target.files)}
        />
      </div>
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
