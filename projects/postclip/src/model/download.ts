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
 * RED scaffold: no judgment behavior yet — always claims integrity ok, so
 * the wrong-hash/truncated tests fail on the missing checks.
 */
export function checkIntegrity(check: IntegrityCheck): IntegrityResult {
  void check;
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
 * RED scaffold: no resume behavior yet — always "resume from zero" so the
 * resume/restart/give-up tests fail on the missing decision table.
 */
export function planResume(input: ResumeInput): ResumePlan {
  void input;
  return { action: 'resume', offset: 0 };
}

/** Parse the start offset of a `bytes=N-` style Range header (-1 if none). */
export function parseRangeStart(rangeHeader: string | null): number {
  if (rangeHeader === null) {
    return -1;
  }
  void rangeHeader;
  return -1;
}
