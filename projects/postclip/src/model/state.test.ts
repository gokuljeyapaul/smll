// @vitest-environment node
/**
 * The model state machine unit tests (S3): nextModelState must implement
 * EXACTLY the plan's absent|downloading|verifying|ready|failed|unsupported
 * table — and every event that is not in the table keeps the current state
 * (fail closed: no event can ever invent a "ready").
 */
import { describe, expect, it } from 'vitest';
import { MODEL_STATES, nextModelState, type ModelEvent, type ModelState } from './state';

const EVENTS: ModelEvent['type'][] = [
  'PROBE_OK',
  'PROBE_FAILED',
  'DOWNLOAD_START',
  'STREAM_COMPLETE',
  'VERIFY_OK',
  'VERIFY_FAILED',
  'HTTP_ERROR',
  'GIVE_UP',
  'PURGED',
];

const ev = (type: ModelEvent['type']): ModelEvent =>
  ({ PROBE_OK: { type: 'PROBE_OK' }, PROBE_FAILED: { type: 'PROBE_FAILED' },
     DOWNLOAD_START: { type: 'DOWNLOAD_START' }, STREAM_COMPLETE: { type: 'STREAM_COMPLETE' },
     VERIFY_OK: { type: 'VERIFY_OK' }, VERIFY_FAILED: { type: 'VERIFY_FAILED' },
     HTTP_ERROR: { type: 'HTTP_ERROR' }, GIVE_UP: { type: 'GIVE_UP' },
     PURGED: { type: 'PURGED' } })[type] as ModelEvent;

describe('nextModelState — model state machine (S3)', () => {
  it('implements the exact legal transition table', () => {
    const table: [ModelState, ModelEvent['type'], ModelState][] = [
      // probe decides between usable and unsupported
      ['absent', 'PROBE_OK', 'absent'],
      ['absent', 'PROBE_FAILED', 'unsupported'],
      ['unsupported', 'PROBE_OK', 'absent'],
      // download lifecycle
      ['absent', 'DOWNLOAD_START', 'downloading'],
      ['downloading', 'STREAM_COMPLETE', 'verifying'],
      ['verifying', 'VERIFY_OK', 'ready'],
      ['verifying', 'VERIFY_FAILED', 'failed'],
      ['downloading', 'HTTP_ERROR', 'failed'],
      ['downloading', 'GIVE_UP', 'failed'],
      // retry from failure (the Try again button re-enters the lifecycle)
      ['failed', 'DOWNLOAD_START', 'downloading'],
      // a new revision may be re-downloaded over a ready model
      ['ready', 'DOWNLOAD_START', 'downloading'],
      // purge returns to absent unless the browser is unsupported
      ['absent', 'PURGED', 'absent'],
      ['downloading', 'PURGED', 'absent'],
      ['verifying', 'PURGED', 'absent'],
      ['ready', 'PURGED', 'absent'],
      ['failed', 'PURGED', 'failed'],
      ['unsupported', 'PURGED', 'unsupported'],
    ];
    for (const [from, event, expected] of table) {
      expect(nextModelState(from, ev(event)), `${from} + ${event}`).toBe(expected);
    }
  });

  it('keeps the current state for every event outside the table (fail closed)', () => {
    const legal: Record<string, Set<ModelState>> = {
      PROBE_OK: new Set(['absent', 'unsupported']),
      PROBE_FAILED: new Set(['absent']),
      DOWNLOAD_START: new Set(['absent', 'failed', 'ready']),
      STREAM_COMPLETE: new Set(['downloading']),
      VERIFY_OK: new Set(['verifying']),
      VERIFY_FAILED: new Set(['verifying']),
      HTTP_ERROR: new Set(['downloading']),
      GIVE_UP: new Set(['downloading']),
      PURGED: new Set([...MODEL_STATES]),
    };
    for (const from of MODEL_STATES) {
      for (const type of EVENTS) {
        if (legal[type].has(from)) continue;
        expect(nextModelState(from, ev(type)), `${from} + ${type} must be a no-op`).toBe(from);
      }
    }
  });
});
