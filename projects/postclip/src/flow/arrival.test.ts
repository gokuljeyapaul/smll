/**
 * The arrival screen-state machine (A34, host): the share-arrival transition
 * table — arrived → reading → result | kind error — plus the kind-error
 * next-step hints (A36). Pure logic; the App drives it (see App.tsx).
 */
import { describe, expect, it } from 'vitest';
import {
  INITIAL_ARRIVAL_STATE,
  KIND_ERROR_NEXT_STEPS,
  kindErrorMessage,
  nextArrivalState,
  type KindErrorReason,
} from './arrival';
import { ERROR_MESSAGES } from '../image/validate';
import { NO_TEXT_MESSAGE } from '../ocr/normalize';
import { NON_ENGLISH_MESSAGE } from '../language/gate';

const REASONS: KindErrorReason[] = ['non-image', 'tiny', 'corrupt', 'no-text', 'non-english', 'unreadable'];

describe('arrival screen-state machine (R2-1, A34)', () => {
  it('idle + image-arrived → reading (the arrival starts reading by itself)', () => {
    const next = nextArrivalState(INITIAL_ARRIVAL_STATE, { type: 'image-arrived' });
    expect(next.phase).toBe('reading');
    expect(next.error).toBeNull();
  });

  it('reading + read-ok → result', () => {
    const reading = { phase: 'reading' as const, error: null };
    const next = nextArrivalState(reading, { type: 'read-ok' });
    expect(next.phase).toBe('result');
    expect(next.error).toBeNull();
  });

  it.each(REASONS)('reading + read-failed(%s) → kind-error carrying the reason', (reason) => {
    const reading = { phase: 'reading' as const, error: null };
    const next = nextArrivalState(reading, { type: 'read-failed', reason });
    expect(next.phase).toBe('kind-error');
    expect(next.error).toEqual({ reason });
  });

  it('kind-error + image-arrived → reading again (a retry clears the error)', () => {
    const failed = { phase: 'kind-error' as const, error: { reason: 'no-text' as const } };
    const next = nextArrivalState(failed, { type: 'image-arrived' });
    expect(next.phase).toBe('reading');
    expect(next.error).toBeNull();
  });

  it('result + image-arrived → reading (a new arrival supersedes the shown result)', () => {
    const result = { phase: 'result' as const, error: null };
    const next = nextArrivalState(result, { type: 'image-arrived' });
    expect(next.phase).toBe('reading');
    expect(next.error).toBeNull();
  });

  it('any + reset → idle (start over)', () => {
    for (const state of [
      { phase: 'reading' as const, error: null },
      { phase: 'result' as const, error: null },
      { phase: 'kind-error' as const, error: { reason: 'corrupt' as const } },
    ]) {
      const next = nextArrivalState(state, { type: 'reset' });
      expect(next).toEqual({ phase: 'idle', error: null });
    }
  });

  it('unknown events leave the state untouched (fail-closed purity)', () => {
    const result = { phase: 'result' as const, error: null };
    expect(nextArrivalState(result, { type: 'nonsense' } as never)).toEqual(result);
  });

  it('an invalid read-failed reason is rejected, not silently mapped (fail closed)', () => {
    const reading = { phase: 'reading' as const, error: null };
    const next = nextArrivalState(reading, { type: 'read-failed', reason: 'bogus' as KindErrorReason });
    // The machine must never invent a state: an unknown reason leaves the
    // state unchanged (the pipeline's catch-all owns the message).
    expect(next).toEqual(reading);
  });

  it('every kind error maps to one non-empty obvious next step (A36)', () => {
    expect(Object.keys(KIND_ERROR_NEXT_STEPS).sort()).toEqual([...REASONS].sort());
    for (const reason of REASONS) {
      const hint = KIND_ERROR_NEXT_STEPS[reason];
      expect(hint, `${reason} next step`).toBeTruthy();
      expect(hint!.length).toBeGreaterThan(10);
    }
  });

  it('every kind error maps to its ONE specific, kind message — the exact A07 strings (A34)', () => {
    expect(kindErrorMessage({ reason: 'non-image' })).toBe(ERROR_MESSAGES['non-image']);
    expect(kindErrorMessage({ reason: 'tiny' })).toBe(ERROR_MESSAGES.tiny);
    expect(kindErrorMessage({ reason: 'corrupt' })).toBe(ERROR_MESSAGES.corrupt);
    expect(kindErrorMessage({ reason: 'no-text' })).toBe(NO_TEXT_MESSAGE);
    expect(kindErrorMessage({ reason: 'non-english' })).toBe(NON_ENGLISH_MESSAGE);
    expect(kindErrorMessage({ reason: 'unreadable', detail: 'boom' })).toBe(
      'Could not read that image: boom',
    );
    expect(kindErrorMessage({ reason: 'unreadable' })).toBe('Could not read that image: unknown error');
  });
});
