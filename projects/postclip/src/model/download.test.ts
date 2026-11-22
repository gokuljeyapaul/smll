// @vitest-environment node
/**
 * Download-integrity decision unit tests (S3 — A12/A13): after a stream
 * ends, size is judged BEFORE the checksum (a truncated file is a
 * size-mismatch, not a checksum failure); the resume/restart/give-up table
 * pins when a dropped connection resumes with a Range request and when it
 * must start over.
 */
import { describe, expect, it } from 'vitest';
import { checkIntegrity, parseRangeStart, planResume } from './download';

describe('checkIntegrity — verify-before-cache judgment (S3)', () => {
  const base = {
    expectedBytes: 1000,
    digestHex: 'aa'.repeat(32),
    expectedSha256: 'aa'.repeat(32),
  };

  it('accepts exact size with the pinned sha256', () => {
    expect(checkIntegrity({ ...base, receivedBytes: 1000 })).toEqual({ ok: true, reason: null });
  });

  it('rejects a checksum mismatch as checksum-mismatch', () => {
    const r = checkIntegrity({ ...base, receivedBytes: 1000, digestHex: 'bb'.repeat(32) });
    expect(r).toEqual({ ok: false, reason: 'checksum-mismatch' });
  });

  it('judges a truncated (shorter) stream as size-mismatch, before hashing matters', () => {
    const r = checkIntegrity({
      ...base,
      receivedBytes: 500,
      digestHex: 'cc'.repeat(32), // even a matching digest must not excuse the size
    });
    expect(r).toEqual({ ok: false, reason: 'size-mismatch' });
  });

  it('judges an oversized stream as size-mismatch', () => {
    const r = checkIntegrity({ ...base, receivedBytes: 1500, digestHex: 'aa'.repeat(32) });
    expect(r).toEqual({ ok: false, reason: 'size-mismatch' });
  });
});

describe('planResume — interrupted download decision (S3)', () => {
  it('resumes from the received offset while attempts remain and ranges are supported', () => {
    expect(
      planResume({ bytesReceived: 700, attemptsUsed: 1, maxAttempts: 3, serverSupportsRanges: true }),
    ).toEqual({ action: 'resume', offset: 700 });
  });

  it('restarts from zero when nothing was received yet', () => {
    expect(
      planResume({ bytesReceived: 0, attemptsUsed: 1, maxAttempts: 3, serverSupportsRanges: true }),
    ).toEqual({ action: 'restart' });
  });

  it('restarts from zero when the server does not support ranges', () => {
    expect(
      planResume({ bytesReceived: 700, attemptsUsed: 1, maxAttempts: 3, serverSupportsRanges: false }),
    ).toEqual({ action: 'restart' });
  });

  it('gives up once the attempt budget is spent', () => {
    expect(
      planResume({ bytesReceived: 700, attemptsUsed: 3, maxAttempts: 3, serverSupportsRanges: true }),
    ).toEqual({ action: 'give-up' });
    expect(
      planResume({ bytesReceived: 0, attemptsUsed: 3, maxAttempts: 3, serverSupportsRanges: true }),
    ).toEqual({ action: 'give-up' });
  });
});

describe('parseRangeStart (S3)', () => {
  it('parses a bytes=N- start offset', () => {
    expect(parseRangeStart('bytes=700-')).toBe(700);
    expect(parseRangeStart('bytes=0-')).toBe(0);
  });

  it('returns -1 for no header or a malformed one', () => {
    expect(parseRangeStart(null)).toBe(-1);
    expect(parseRangeStart('items=0-5')).toBe(-1);
    expect(parseRangeStart('bytes=abc-')).toBe(-1);
  });
});
