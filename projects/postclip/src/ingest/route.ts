/**
 * Input routing (S2, A08/A09/A10): pure, DOM-typed logic that turns each
 * input channel — a paste event, a clipboard read, or a share-target
 * message from the service worker — into the File the pipeline consumes,
 * or a specific, kind, fail-closed message. The UI layer only wires these
 * helpers to real browser events; the behavior itself is unit-tested here.
 *
 * SCAFFOLD STATE (S2 RED): every function returns null / empty so the new
 * behavioral tests fail on assertions (never import errors), exactly like
 * the S1 scaffold pattern in docs/evidence/S1/red.log.
 */

/** The message the service worker sends when a shared image arrives (UC02). */
export interface ShareTargetImageMessage {
  type: 'postclip-share-image';
  name: string;
  mime: string;
  blob: Blob;
}

export const CLIPBOARD_DENIED_MESSAGE =
  'Pasting needs clipboard permission, which is currently blocked for this site. You can still add your screenshot with the Choose screenshot button below.';

export const CLIPBOARD_UNAVAILABLE_MESSAGE =
  'This browser cannot hand images to PostClip through the clipboard here. You can still add your screenshot with the Choose screenshot button below.';

export const CLIPBOARD_READ_FAILED_MESSAGE =
  'The clipboard could not be read right now. You can still add your screenshot with the Choose screenshot button below.';

/**
 * UC03, paste event: the first image file on a paste event's clipboardData,
 * or null when the paste carries no image (text-only pastes stay untouched
 * — the review textarea's normal text pasting must keep working).
 */
export function imageFileFromDataTransferFiles(_files: readonly File[]): File | null {
  return null; // scaffold (S2 RED)
}

/**
 * UC03, Paste button: read the clipboard via navigator.clipboard.read() and
 * return its image as a File, or null when the clipboard holds no image.
 * getType() failures propagate to the caller (the UI shows the fail-closed
 * message; the pipeline never receives a half-read blob).
 */
export async function imageFileFromClipboardRead(
  _items: ReadonlyArray<{ types: readonly string[]; getType(mime: string): Promise<Blob> }>,
): Promise<File | null> {
  return null; // scaffold (S2 RED)
}

/**
 * UC02, share target: validate a service-worker message and turn it into
 * the File the pipeline consumes. Fail closed: anything that is not exactly
 * a well-formed share-image message with an image blob yields null — an
 * unknown or malformed message never reaches the pipeline.
 */
export function shareTargetFileFromMessage(_data: unknown): File | null {
  return null; // scaffold (S2 RED)
}

/** UC12: map a clipboard failure to the specific, kind message the UI shows. */
export function clipboardReadErrorMessage(_err: unknown): string {
  return ''; // scaffold (S2 RED)
}

/**
 * UC12: a proactive hint under the Paste button when the permission state is
 * known-denied (queried via navigator.permissions where supported), or null
 * when no hint is warranted (granted, prompt, or not queryable).
 */
export function clipboardPermissionHint(_permissionState: string | null): string | null {
  return null; // scaffold (S2 RED)
}
