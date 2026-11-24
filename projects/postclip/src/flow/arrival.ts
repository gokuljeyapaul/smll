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

import { ERROR_MESSAGES } from '../image/validate';
import { NO_TEXT_MESSAGE } from '../ocr/normalize';
import { NON_ENGLISH_MESSAGE } from '../language/gate';

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

/** The machine's view of an error: the reason plus (for the unreadable
 * catch-all) the raw detail, which the specific message embeds. */
export interface ArrivalError {
  reason: KindErrorReason;
  detail?: string;
}

export interface ArrivalState {
  phase: ArrivalPhase;
  error: ArrivalError | null;
}

export type ArrivalEvent =
  | { type: 'image-arrived' }
  | { type: 'read-ok' }
  | { type: 'read-failed'; reason: KindErrorReason; detail?: string }
  | { type: 'reset' };

export const INITIAL_ARRIVAL_STATE: ArrivalState = { phase: 'idle', error: null };

const KIND_ERROR_REASONS: ReadonlySet<string> = new Set([
  'non-image',
  'tiny',
  'corrupt',
  'no-text',
  'non-english',
  'unreadable',
]);

/** A reason is valid only if the machine knows it (fail closed). */
function isKindErrorReason(reason: unknown): reason is KindErrorReason {
  return KIND_ERROR_REASONS.has(reason as string);
}

/**
 * The pure transition table. Unknown events and invalid reasons leave the
 * state untouched — the machine never invents a state (the pipeline's
 * catch-all owns the unexpected; nothing is silently dropped there).
 */
export function nextArrivalState(state: ArrivalState, event: ArrivalEvent): ArrivalState {
  switch (event.type) {
    case 'image-arrived':
      // A new arrival supersedes whatever was on screen (a previous result
      // or a kind error) and starts reading by itself — no extra tap.
      return { phase: 'reading', error: null };
    case 'read-ok':
      // Only a read in flight can land on the result.
      return state.phase === 'reading' ? { phase: 'result', error: null } : state;
    case 'read-failed':
      if (state.phase !== 'reading' || !isKindErrorReason(event.reason)) return state;
      return { phase: 'kind-error', error: { reason: event.reason } };
    case 'reset':
      return INITIAL_ARRIVAL_STATE;
    default:
      return state;
  }
}

/**
 * The ONE obvious next step for each kind error (A36). Every hint names the
 * still-working input route — the file picker on the home screen, one tap
 * away right under the message.
 */
export const KIND_ERROR_NEXT_STEPS: Record<KindErrorReason, string> = {
  'non-image': 'Next step: share a screenshot image, or choose one with the button below.',
  tiny: 'Next step: try a larger screenshot, or choose one with the button below.',
  corrupt: 'Next step: the file seems damaged — share it again, or choose another image below.',
  'no-text': 'Next step: pick or paste a sharper screenshot with the button below.',
  'non-english': 'Next step: pick an English-language screenshot with the button below.',
  unreadable: 'Next step: pick or paste another screenshot with the button below.',
};

/**
 * A34: every kind error maps to its ONE specific, kind user-facing message
 * — the exact strings the A07 suite asserts, unchanged by R2-1. The
 * 'unreadable' catch-all embeds the raw detail (the previous behaviour).
 */
export function kindErrorMessage(error: ArrivalError): string {
  switch (error.reason) {
    case 'non-image':
      return ERROR_MESSAGES['non-image'];
    case 'tiny':
      return ERROR_MESSAGES.tiny;
    case 'corrupt':
      return ERROR_MESSAGES.corrupt;
    case 'no-text':
      return NO_TEXT_MESSAGE;
    case 'non-english':
      return NON_ENGLISH_MESSAGE;
    case 'unreadable':
      return `Could not read that image: ${error.detail ?? 'unknown error'}`;
  }
}
