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
  | { type: 'CACHE_HIT' }
  | { type: 'PURGED' };

export const MODEL_STATES: ModelState[] = [
  'absent',
  'downloading',
  'verifying',
  'ready',
  'failed',
  'unsupported',
];

/** The exact legal transitions; everything else is a no-op. */
const TABLE: Partial<Record<ModelEvent['type'], Partial<Record<ModelState, ModelState>>>> = {
  PROBE_OK: { absent: 'absent', unsupported: 'absent' },
  PROBE_FAILED: { absent: 'unsupported' },
  DOWNLOAD_START: { absent: 'downloading', downloading: 'downloading', failed: 'downloading', ready: 'downloading' },
  STREAM_COMPLETE: { downloading: 'verifying' },
  VERIFY_OK: { verifying: 'ready' },
  VERIFY_FAILED: { verifying: 'failed' },
  HTTP_ERROR: { downloading: 'failed' },
  GIVE_UP: { downloading: 'failed', verifying: 'failed' },
  CACHE_HIT: { absent: 'ready' },
  PURGED: {
    absent: 'absent',
    downloading: 'absent',
    verifying: 'absent',
    ready: 'absent',
    failed: 'failed',
    unsupported: 'unsupported',
  },
};

export function nextModelState(current: ModelState, event: ModelEvent): ModelState {
  return TABLE[event.type]?.[current] ?? current;
}
