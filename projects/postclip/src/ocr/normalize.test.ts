import { describe, expect, it } from 'vitest';
import { normalizeOcrLines } from './normalize';

describe('normalizeOcrLines — OCR result normalizer (S0)', () => {
  it('trims leading and trailing whitespace from each line', () => {
    const { lines } = normalizeOcrLines(['  hello  ', '\tworld\t']);
    expect(lines).toEqual(['hello', 'world']);
  });

  it('drops empty and whitespace-only lines', () => {
    const { lines } = normalizeOcrLines(['one', '', '   ', 'two']);
    expect(lines).toEqual(['one', 'two']);
  });

  it('collapses runs of spaces and tabs inside a line to a single space', () => {
    const { lines } = normalizeOcrLines(['a   b\t\tc']);
    expect(lines).toEqual(['a b c']);
  });

  it('joins surviving lines with single newlines and trims the result', () => {
    const { text } = normalizeOcrLines([' one ', '', 'two  ']);
    expect(text).toBe('one\ntwo');
  });

  it('returns empty output for all-empty input', () => {
    expect(normalizeOcrLines(['', '  '])).toEqual({ lines: [], text: '' });
  });

  it('preserves character content exactly, including punctuation and emoji', () => {
    const { text } = normalizeOcrLines(['Ship it 🚀 — done.', 'tags: #build #learn']);
    expect(text).toBe('Ship it 🚀 — done.\ntags: #build #learn');
  });
});
