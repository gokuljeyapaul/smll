/**
 * Build the outbound payloads for Share and Copy.
 *
 * S0 contract (tested in payload.test.ts):
 *  - the Web Share payload's `text` is EXACTLY the review text, character for character;
 *  - the payload carries the fixed title "PostClip";
 *  - Copy writes the exact review text to the clipboard.
 *
 * S1 adds the export builders (A05): .txt and .md carry the review text
 * verbatim; .json is a deterministic JSON document with the review text
 * under `text` (no timestamps, so downloads are byte-reproducible).
 */
export function buildSharePayload(reviewText: string): ShareData {
  return { title: 'PostClip', text: reviewText };
}

export async function copyReviewText(reviewText: string): Promise<void> {
  await navigator.clipboard.writeText(reviewText);
}

export type ExportFormat = 'md' | 'txt' | 'json';

/** The download filename for a format (fixed, deterministic, carries no
 *  post text). */
export function exportFilename(format: ExportFormat): string {
  return `postclip-export.${format}`;
}

export function mimeTypeFor(format: ExportFormat): string {
  switch (format) {
    case 'md':
      return 'text/markdown';
    case 'json':
      return 'application/json';
    case 'txt':
      return 'text/plain';
  }
}

/** The file content for a format: .txt and .md carry the review text
 *  verbatim; .json is a deterministic document with the review text under
 *  `text` (no timestamps, so downloads are byte-reproducible). */
export function buildExportPayload(reviewText: string, format: ExportFormat): string {
  if (format === 'md' || format === 'txt') {
    return reviewText;
  }
  return `${JSON.stringify({ app: 'postclip', format: 1, text: reviewText }, null, 2)}\n`;
}

/** Trigger a real browser download of the review text in the given format.
 *  The download is a local blob URL — nothing is uploaded anywhere. */
export function downloadExport(reviewText: string, format: ExportFormat): void {
  const payload = buildExportPayload(reviewText, format);
  const blob = new Blob([payload], { type: mimeTypeFor(format) });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = exportFilename(format);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Give the browser a moment to take the download before releasing the blob.
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
