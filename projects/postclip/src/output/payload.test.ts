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
