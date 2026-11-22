/**
 * The model manager's state machine (S3 — plan scope item "state machine
 * (absent|downloading|verifying|ready|failed|unsupported)"). A pure
 * transition function: the manager applies it, the unit tests pin the
 * exact table, and anything not in the table keeps the current state
 * (fail closed — an unknown event can never invent a "ready").
 */

export type ModelState =
  | 'absent'
  | 'downloading'
  | 'verifying'
  | 'ready'
  | 'failed'
  | 'unsupported';

export type ModelFailReason =
  | 'checksum-mismatch'
  | 'size-mismatch'
  | 'http-error'
  | 'network-error'
  | 'storage-error'
  | 'unsupported';

export type ModelEvent =
  | { type: 'PROBE_OK' }
  | { type: 'PROBE_FAILED' }
  | { type: 'DOWNLOAD_START' }
  | { type: 'STREAM_COMPLETE' }
  | { type: 'VERIFY_OK' }
  | { type: 'VERIFY_FAILED' }
  | { type: 'HTTP_ERROR' }
  | { type: 'GIVE_UP' }
  | { type: 'PURGED' };

export const MODEL_STATES: ModelState[] = [
  'absent',
  'downloading',
  'verifying',
  'ready',
  'failed',
  'unsupported',
];

/**
 * RED scaffold: no transition behavior yet — every event is ignored, so the
 * state can never leave `absent` (the behavioral tests fail on exactly the
 * missing transitions).
 */
export function nextModelState(current: ModelState, event: ModelEvent): ModelState {
  void event;
  return current;
}
