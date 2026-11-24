/**
 * The arrival screen-state machine (R2-1, A34): the pure transition table
 * behind what the user sees when an image ARRIVES — shared into the
 * installed app, pasted, picked, or handed over by a host app (R2-2).
 *
 *   idle --image-arrived--> reading --read-ok--> result
 *                                  \--read-failed--> kind-error
 *   kind-error --image-arrived--> reading (retry with a new screenshot)
 *   any --reset--> idle
 *
 * Every kind error carries its reason; the UI maps the reason to the
 * specific, kind message (the exact strings UC11 asserts) plus ONE obvious
 * next step (A36). The machine owns only phase + error — no side effects,
 * no storage, no DOM: it is unit-testable logic the App drives.
 */

/** The phases the arrival screen can be in. */
export type ArrivalPhase = 'idle' | 'reading' | 'result' | 'kind-error';

/** Why a read failed — each maps to one specific, kind message (A34/A36). */
export type KindErrorReason =
  | 'non-image'
  | 'tiny'
  | 'corrupt'
  | 'no-text'
  | 'non-english'
  | 'unreadable';

/** The machine's view of an error: the reason, never a free-form string. */
export interface ArrivalError {
  reason: KindErrorReason;
}

export interface ArrivalState {
  phase: ArrivalPhase;
  error: ArrivalError | null;
}

export type ArrivalEvent =
  | { type: 'image-arrived' }
  | { type: 'read-ok' }
  | { type: 'read-failed'; reason: KindErrorReason }
  | { type: 'reset' };

export const INITIAL_ARRIVAL_STATE: ArrivalState = { phase: 'idle', error: null };

/**
 * RED scaffold (R2-1 TDD): this function exists so the arrival suite runs
 * against real, compiling code, but the transitions are NOT implemented
 * yet — it returns the state unchanged, so every behavioural assertion in
 * arrival.test.ts fails on assertions (not on imports). The GREEN step
 * replaces this body with the real transition table.
 */
export function nextArrivalState(state: ArrivalState, _event: ArrivalEvent): ArrivalState {
  void _event;
  return state;
}

/**
 * The one obvious next step for each kind error (A36). Every hint names the
 * still-working input route (the file picker on the home screen).
 * RED scaffold: empty until the GREEN step.
 */
export const KIND_ERROR_NEXT_STEPS: Partial<Record<KindErrorReason, string>> = {};
