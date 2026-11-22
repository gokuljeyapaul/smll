/**
 * Input routing (S2, A08/A09/A10): pure, DOM-typed logic that turns each
 * input channel — a paste event, a clipboard read, or a share-target
 * message from the service worker — into the File the pipeline consumes,
 * or a specific, kind, fail-closed message. The UI layer only wires these
 * helpers to real browser events; the behavior itself is unit-tested in
 * route.test.ts and driven end to end by the uc03/a08/a10/a11 e2e specs.
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
export function imageFileFromDataTransferFiles(files: readonly File[]): File | null {
  for (const file of files) {
    if (file.type.startsWith('image/')) return file;
  }
  return null;
}

/**
 * UC03, Paste button: read the clipboard via navigator.clipboard.read() and
 * return its image as a File, or null when the clipboard holds no image.
 * getType() failures propagate to the caller (the UI shows the fail-closed
 * message; the pipeline never receives a half-read blob).
 */
export async function imageFileFromClipboardRead(
  items: ReadonlyArray<{ types: readonly string[]; getType(mime: string): Promise<Blob> }>,
): Promise<File | null> {
  const IMAGE_TYPE_RE = /^image\/[a-z0-9.+-]+$/i;
  for (const item of items) {
    const mime = item.types.find((t) => IMAGE_TYPE_RE.test(t));
    if (!mime) continue;
    const blob = await item.getType(mime);
    const ext = mime.split('/')[1]?.split('+')[0] ?? 'img';
    return new File([blob], `pasted-from-clipboard.${ext}`, { type: mime });
  }
  return null;
}

/**
 * UC02, share target: validate a service-worker message and turn it into
 * the File the pipeline consumes. Fail closed: anything that is not exactly
 * a well-formed share-image message with an image blob yields null — an
 * unknown or malformed message never reaches the pipeline.
 */
export function shareTargetFileFromMessage(data: unknown): File | null {
  if (typeof data !== 'object' || data === null) return null;
  const msg = data as Partial<ShareTargetImageMessage>;
  if (msg.type !== 'postclip-share-image') return null;
  if (typeof msg.mime !== 'string' || !msg.mime.startsWith('image/')) return null;
  if (!(msg.blob instanceof Blob)) return null;
  const name =
    typeof msg.name === 'string' && msg.name.trim().length > 0 ? msg.name : `shared-image.${msg.mime.split('/')[1] ?? 'img'}`;
  return new File([msg.blob], name, { type: msg.mime });
}

/** UC12: map a clipboard failure to the specific, kind message the UI shows. */
export function clipboardReadErrorMessage(err: unknown): string {
  const name = err instanceof DOMException ? err.name : err instanceof TypeError ? 'TypeError' : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return CLIPBOARD_DENIED_MESSAGE;
  if (name === 'NotSupportedError' || name === 'TypeError') return CLIPBOARD_UNAVAILABLE_MESSAGE;
  return CLIPBOARD_READ_FAILED_MESSAGE;
}

/**
 * UC12: a proactive hint under the Paste button when the permission state is
 * known-denied (queried via navigator.permissions where supported), or null
 * when no hint is warranted (granted, prompt, or not queryable).
 */
export function clipboardPermissionHint(permissionState: string | null): string | null {
  if (permissionState === 'denied') return CLIPBOARD_DENIED_MESSAGE;
  return null;
}
