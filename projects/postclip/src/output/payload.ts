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
 *
 * S4 (plan "LLM safety design" point 5, UC05) adds the SUGGESTION toggles:
 * author/tags/summary may join the payloads ONLY when the user toggled the
 * field on; by default (no extras) every payload remains exactly the
 * review text (the A03 invariant).
 */
export interface ShareExtras {
  /** Verified author (the guard keeps it only when it literally appears). */
  author: string | null;
  /** Suggested tags (guarded, demoted on injection-looking input). */
  tags: string[];
  /** Suggested summary (guarded, demoted on injection-looking input). */
  summary: string | null;
  /** Toggle: include the author line (default off). */
  includeAuthor?: boolean;
  /** Toggle: include the tags line (default off). */
  includeTags?: boolean;
  /** Toggle: include the summary line (default off). */
  includeSummary?: boolean;
}

/**
 * The labelled metadata block the toggles append AFTER the review text
 * (S4, plan point 5): every included field gets one clearly-labelled line,
 * nothing more. Default (no extras, or no toggles) = empty string, so the
 * A03 invariant (payload text is EXACTLY the review text) holds unless the
 * user opted in.
 */
function buildExtrasBlock(extras: ShareExtras | undefined): string {
  if (!extras) return '';
  const lines: string[] = [];
  if (extras.includeAuthor && extras.author) {
    lines.push(`Author: ${extras.author}`);
  }
  if (extras.includeTags && extras.tags.length > 0) {
    const tags = extras.tags.map((tag) => (tag.startsWith('#') ? tag : `#${tag}`)).join(' ');
    lines.push(`Tags: ${tags}`);
  }
  if (extras.includeSummary && extras.summary) {
    lines.push(`Summary: ${extras.summary}`);
  }
  return lines.length > 0 ? `\n\n${lines.join('\n')}` : '';
}

/** The structured fields the .json export carries when toggles are on. */
function extrasJsonFields(extras: ShareExtras | undefined): Record<string, unknown> {
  if (!extras) return {};
  const fields: Record<string, unknown> = {};
  if (extras.includeAuthor && extras.author) fields.author = extras.author;
  if (extras.includeTags && extras.tags.length > 0) fields.tags = extras.tags;
  if (extras.includeSummary && extras.summary) fields.summary = extras.summary;
  return fields;
}

/** The share payload always carries a text (this is PostClip's contract:
 *  the review text plus, only when toggled on, the labelled metadata). */
export function buildSharePayload(reviewText: string, extras?: ShareExtras): ShareData & { text: string } {
  return { title: 'PostClip', text: reviewText + buildExtrasBlock(extras) };
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
 *  verbatim (plus the toggled metadata block); .json is a deterministic
 *  document with the review text under `text` (no timestamps, so downloads
 *  are byte-reproducible). */
export function buildExportPayload(reviewText: string, format: ExportFormat, extras?: ShareExtras): string {
  if (format === 'md' || format === 'txt') {
    return reviewText + buildExtrasBlock(extras);
  }
  const document = { app: 'postclip', format: 1, text: reviewText, ...extrasJsonFields(extras) };
  return `${JSON.stringify(document, null, 2)}\n`;
}

/** Trigger a real browser download of the review text in the given format.
 *  The download is a local blob URL — nothing is uploaded anywhere. */
export function downloadExport(reviewText: string, format: ExportFormat, extras?: ShareExtras): void {
  const payload = buildExportPayload(reviewText, format, extras);
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
