import { describe, expect, it, vi } from 'vitest';
import { buildSharePayload, copyReviewText } from './payload';

describe('buildSharePayload — Web Share payload builder (S0)', () => {
  it('carries the exact review text, character for character', () => {
    const reviewText = 'Line one\nLine two — with “quotes”, emoji 🙂 and   spaces';
    expect(buildSharePayload(reviewText).text).toBe(reviewText);
  });

  it('uses the fixed app title', () => {
    expect(buildSharePayload('x').title).toBe('PostClip');
  });

  it('never trims or mutates the review text', () => {
    const padded = '  padded  ';
    expect(buildSharePayload(padded).text).toBe(padded);
  });
});

describe('copyReviewText — clipboard copy (S0)', () => {
  it('writes the exact review text to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    await copyReviewText('exact text\nwith lines');
    expect(writeText).toHaveBeenCalledWith('exact text\nwith lines');
    vi.unstubAllGlobals();
  });

  it('rejects when the clipboard refuses, so the UI can surface the failure', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    await expect(copyReviewText('t')).rejects.toThrow('denied');
    vi.unstubAllGlobals();
  });
});

import {
  buildExportPayload,
  exportFilename,
  mimeTypeFor,
  type ExportFormat,
} from './payload';

describe('buildExportPayload — file export builders (S1, A05, A04)', () => {
  const reviewText = 'Shipped our first offline-first release today.\nNo cloud, no accounts. #buildinpublic';

  it('.txt content is exactly the review text, character for character', () => {
    expect(buildExportPayload(reviewText, 'txt')).toBe(reviewText);
  });

  it('.md content is exactly the review text, character for character', () => {
    expect(buildExportPayload(reviewText, 'md')).toBe(reviewText);
  });

  it('.json content is a deterministic document carrying the exact review text', () => {
    const json = buildExportPayload(reviewText, 'json');
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(['app', 'format', 'text']);
    expect(parsed.app).toBe('postclip');
    expect(parsed.format).toBe(1);
    expect(parsed.text).toBe(reviewText);
    // deterministic: two calls produce identical bytes (no timestamps)
    expect(buildExportPayload(reviewText, 'json')).toBe(json);
  });

  it('the export payload always reflects the CURRENT text, edits included', () => {
    const edited = reviewText + '\n\n(Added while reviewing.)';
    expect(buildExportPayload(edited, 'txt')).toBe(edited);
    expect(JSON.parse(buildExportPayload(edited, 'json')).text).toBe(edited);
  });

  it('filenames are fixed per format and carry no post text', () => {
    for (const format of ['md', 'txt', 'json'] as ExportFormat[]) {
      expect(exportFilename(format)).toBe(`postclip-export.${format}`);
    }
  });

  it('MIME types match the formats', () => {
    expect(mimeTypeFor('md')).toBe('text/markdown');
    expect(mimeTypeFor('txt')).toBe('text/plain');
    expect(mimeTypeFor('json')).toBe('application/json');
  });
});
