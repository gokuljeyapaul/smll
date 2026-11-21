import { useCallback, useState } from 'react';
import { Home } from './ui/Home';
import { Review } from './ui/Review';

export type OcrStatus = 'idle' | 'reading' | 'ready' | 'error';

export function App() {
  const [status, setStatus] = useState<OcrStatus>('idle');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const onImageSelected = useCallback((file: File) => {
    setImageFile(file);
    // OCR pipeline arrives with the OCR engine slice; scaffold state machine only.
    setError('Reading screenshots is not available in this scaffold yet.');
    setStatus('error');
  }, []);

  const onStartOver = useCallback(() => {
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
