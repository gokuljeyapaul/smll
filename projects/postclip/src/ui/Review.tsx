import type { OcrStatus } from '../App';

export interface ReviewProps {
  text: string;
  status: OcrStatus;
  imageFile: File | null;
  onTextChange: (text: string) => void;
  onStartOver: () => void;
}

export function Review({ text, status, imageFile, onTextChange, onStartOver }: ReviewProps) {
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
    </main>
  );
}
