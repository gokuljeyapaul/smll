/**
 * Pure download-integrity decisions for the model manager (S3 — A12/A13):
 * size and checksum judgment AFTER a stream ends, and the resume/restart
 * decision AFTER a connection drops. Kept pure so the vitest suite pins
 * the exact rules the browser flows rely on.
 */

import type { ModelFailReason } from './state';

export interface IntegrityCheck {
  receivedBytes: number;
  expectedBytes: number;
  digestHex: string;
  expectedSha256: string;
}

export interface IntegrityResult {
  ok: boolean;
  /** null when ok; otherwise one of 'size-mismatch' | 'checksum-mismatch'. */
  reason: ModelFailReason | null;
}

/**
 * Verify-before-cache judgment: size first (a truncated or oversized body
 * is a size-mismatch no digest can excuse), then the pinned sha256.
 */
export function checkIntegrity(check: IntegrityCheck): IntegrityResult {
  if (check.receivedBytes !== check.expectedBytes) {
    return { ok: false, reason: 'size-mismatch' };
  }
  if (check.digestHex !== check.expectedSha256) {
    return { ok: false, reason: 'checksum-mismatch' };
  }
  return { ok: true, reason: null };
}

export interface ResumeInput {
  bytesReceived: number;
  attemptsUsed: number;
  maxAttempts: number;
  /** Server Range support as last observed (a 206 response proves it). */
  serverSupportsRanges: boolean;
}

export type ResumePlan =
  | { action: 'resume'; offset: number }
  | { action: 'restart' }
  | { action: 'give-up' };

/**
 * After a dropped connection: resume from the received offset while the
 * attempt budget lasts and the server speaks Range; restart from zero when
 * there is nothing to resume from or Range is unsupported; give up when
 * the budget is spent (the app then falls back — A13).
 */
export function planResume(input: ResumeInput): ResumePlan {
  if (input.attemptsUsed >= input.maxAttempts) {
    return { action: 'give-up' };
  }
  if (input.bytesReceived > 0 && input.serverSupportsRanges) {
    return { action: 'resume', offset: input.bytesReceived };
  }
  return { action: 'restart' };
}

/** Parse the start offset of a `bytes=N-` style Range header (-1 if none). */
export function parseRangeStart(rangeHeader: string | null): number {
  const m = rangeHeader?.match(/^bytes=(\d+)-/);
  return m ? Number(m[1]) : -1;
}
