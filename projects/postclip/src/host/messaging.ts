/**
 * The host messaging contract (R2-2, A44 — issue #79): the postMessage
 * protocol that lets a host app embed PostClip in an iframe/WebView, hand
 * it a screenshot, and receive the extracted text back — with an origin
 * allow-list (default: NONE accepted), strict message validation, and
 * replies that go ONLY to an allow-listed origin (never "*").
 *
 * Privacy rules unchanged: no post text in URLs, logs, storage or network;
 * the only thing that leaves the app is the result postMessage to the
 * allow-listed origin. Messages from non-allow-listed origins are ignored
 * and never logged with content.
 *
 * Pure logic here (unit-tested in messaging.test.ts); the DOM wiring
 * lives in the bridge at the bottom of this file.
 */

/** host → PostClip: hand a screenshot to the embedded app. */
export const HOST_MSG_LOAD_IMAGE = 'postclip:load-image';
/** PostClip → host: the bridge is live and accepting messages. */
export const HOST_MSG_READY = 'postclip:ready';
/** PostClip → host: the text for a requestId (may repeat if the optional
 *  model cleanup upgrades it — the last one wins). */
export const HOST_MSG_RESULT = 'postclip:result';
/** PostClip → host: a load failed; `code` says why. */
export const HOST_MSG_ERROR = 'postclip:error';

/** The maximum accepted image size (32 MiB). Larger messages are rejected
 *  with `too-large` — the app downscales huge images itself, but the host
 *  channel is bounded so a hostile page cannot push unbounded memory. */
export const HOST_MAX_IMAGE_BYTES = 32 * 1024 * 1024;

/** The MIME types a host may hand over (the screenshot formats the sniff
 *  stage can actually read). Anything else is rejected (`unsupported-mime`). */
export const HOST_MIME_ALLOWLIST: readonly string[] = ['image/png', 'image/jpeg', 'image/webp'];

/** The query parameter carrying the URL-encoded, comma-separated origin
 *  allow-list (documented in docs/INTEGRATION.md). Origins only — never
 *  post content; a URL is never a data channel for post text. */
export const HOST_ALLOWLIST_PARAM = 'host';

/** The build-time allow-list (comma-separated origins baked by
 *  VITE_POSTCLIP_HOST_ORIGINS at build time). Query param and build-time
 *  entries are merged; the default for both is EMPTY (nothing accepted). */
export const HOST_ALLOWLIST_ENV = 'VITE_POSTCLIP_HOST_ORIGINS';

/** Why a host message was rejected (the `postclip:error` `code`). The
 *  pipeline's kind-error reasons map 1:1; the channel adds its own. */
export type HostErrorCode =
  | 'non-image'
  | 'tiny'
  | 'corrupt'
  | 'no-text'
  | 'non-english'
  | 'unreadable'
  | 'bad-message'
  | 'too-large'
  | 'unsupported-mime';

export interface HostLoadImageMessage {
  type: 'postclip:load-image';
  /** The screenshot bytes (Blob or ArrayBuffer). */
  image: Blob | ArrayBuffer;
  /** The declared MIME type (must be in the allow-list). */
  mime: string;
  /** The host's correlation id, echoed on result/error. */
  requestId: string;
}

/** The verdict for an incoming host message. */
export type HostLoadImageVerdict =
  | { kind: 'accepted'; file: File; requestId: string }
  | { kind: 'ignored'; why: HostErrorCode };

/** The longest requestId echoed back (bounded; longer ids are rejected
 *  as malformed rather than reflected anywhere). */
const MAX_REQUEST_ID = 128;

/** One candidate origin string → its absolute http(s) origin, or null
 *  (anything else is dropped, never coerced or guessed). */
function normalizeOrigin(candidate: string): string | null {
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Parse one comma-separated, URL-encoded origin list (the `?host=` query
 * parameter or the build-time value). Only absolute http(s) origins parse;
 * anything else is DROPPED (never coerced, never guessed).
 */
export function parseHostOrigins(param: string | null | undefined): string[] {
  if (!param) return [];
  // The app reads this from URLSearchParams (already %-decoded); accept the
  // fully-encoded form too by decoding once before splitting (idempotent
  // for plain origins).
  let decoded = String(param);
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // leave as-is — a malformed escape is dropped below, never guessed
  }
  const out: string[] = [];
  for (const raw of decoded.split(',')) {
    const candidate = raw.trim();
    if (!candidate) continue;
    const origin = normalizeOrigin(candidate);
    if (origin && !out.includes(origin)) out.push(origin);
  }
  return out;
}

/**
 * The effective allow-list: build-time env origins + the query-param
 * origins, de-duplicated, origin-normalized. Default: empty (NONE
 * accepted from other origins).
 */
export function hostAllowList(
  envValue: string | undefined,
  queryParam: string | null | undefined,
): string[] {
  const out = parseHostOrigins(envValue);
  for (const origin of parseHostOrigins(queryParam)) {
    if (!out.includes(origin)) out.push(origin);
  }
  return out;
}

function isHostLoadImageMessage(data: unknown): data is HostLoadImageMessage {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as Record<string, unknown>;
  if (d.type !== HOST_MSG_LOAD_IMAGE) return false;
  if (typeof d.image !== 'object' || d.image === null) return false;
  if (typeof Blob !== 'undefined' && d.image instanceof Blob) {
    // fine — the normal case
  } else if (d.image instanceof ArrayBuffer) {
    // fine — the ArrayBuffer case
  } else {
    return false;
  }
  if (typeof d.mime !== 'string') return false;
  if (typeof d.requestId !== 'string' || d.requestId.length === 0 || d.requestId.length > MAX_REQUEST_ID) {
    return false;
  }
  return true;
}

function imageSize(image: Blob | ArrayBuffer): number {
  return image instanceof ArrayBuffer ? image.byteLength : image.size;
}

/**
 * Validate an incoming `postclip:load-image` from `origin`. Checks, in
 * order: the origin is allow-listed (else ignored, content untouched and
 * unlogged), the shape is exactly the contract (type, Blob/ArrayBuffer
 * image, requestId string), the MIME is allowed, and the size is within
 * the cap. Accepted messages become a File for the normal arrival
 * pipeline; rejected ones stay ignored (fail closed — the pipeline never
 * sees a half-valid message).
 */
export function validateHostLoadImage(
  data: unknown,
  origin: string,
  allowList: readonly string[],
): HostLoadImageVerdict {
  // 1. The origin gate runs BEFORE anything else: a non-allow-listed
  //    sender is ignored outright — its content is never inspected,
  //    coerced or logged.
  if (!allowList.includes(origin)) return { kind: 'ignored', why: 'bad-message' };
  // 2. Shape: exactly the documented contract.
  if (!isHostLoadImageMessage(data)) return { kind: 'ignored', why: 'bad-message' };
  // 3. MIME allow-list.
  if (!HOST_MIME_ALLOWLIST.includes(data.mime)) return { kind: 'ignored', why: 'unsupported-mime' };
  // 4. Size cap.
  if (imageSize(data.image) > HOST_MAX_IMAGE_BYTES) return { kind: 'ignored', why: 'too-large' };
  // Accepted: a normal File on the normal arrival path.
  const ext = data.mime.split('/')[1]?.split('+')[0] ?? 'img';
  const file = new File([data.image], `from-host-app.${ext}`, { type: data.mime });
  return { kind: 'accepted', file, requestId: data.requestId };
}

/** The reply target for a message that came from `origin`: the origin
 *  itself when allow-listed, else null (never "*", never a guess). */
export function replyTargetFor(origin: string, allowList: readonly string[]): string | null {
  return allowList.includes(origin) ? origin : null;
}

export interface HostBridgeHandlers {
  /** A valid load-image arrived from an allow-listed origin. */
  onLoadImage(file: File, requestId: string): void;
}

export interface HostBridge {
  /** The effective allow-list (read-only view for the UI/tests). */
  readonly allowList: readonly string[];
  /** Whether the app is embedded (an iframe/WebView). */
  readonly embedded: boolean;
  /** Post `postclip:result` for a requestId (last one wins, per contract). */
  reportResult(requestId: string, text: string): void;
  /** Post `postclip:error` for a requestId. */
  reportError(requestId: string, code: HostErrorCode): void;
  destroy(): void;
}

/** The minimal window surface the bridge needs (injectable for tests). */
interface BridgeWindow {
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
}

/** The minimal parent surface the bridge needs (injectable for tests). */
interface BridgeParent {
  postMessage(data: unknown, targetOrigin: string): void;
}

/**
 * Install the host bridge: the window message listener + the outgoing
 * postMessage surface. Returns null (and installs NOTHING) when the
 * allow-list is empty or the app is not embedded — normal standalone
 * usage is byte-for-byte unaffected (no listener, no ready message).
 */
export function createHostBridge(opts: {
  allowList: readonly string[];
  handlers: HostBridgeHandlers;
  win?: BridgeWindow;
  parent?: unknown;
}): HostBridge | null {
  const allowList = [...opts.allowList];
  if (allowList.length === 0) return null;

  const win: BridgeWindow = opts.win ?? (globalThis as unknown as BridgeWindow);
  // `window.parent !== window` is the embedded check — a reference
  // comparison, allowed cross-origin (no window.top anywhere; A43).
  const parentWindow = (opts.parent ?? (win as unknown as { parent?: unknown }).parent) as
    | BridgeParent
    | undefined;
  const embedded = parentWindow !== undefined && parentWindow !== (win as unknown);
  if (!embedded || !parentWindow) return null;

  /** The origin of the last ACCEPTED load — replies go back to it (an
   *  allow-listed origin by construction), never to "*". */
  let lastLoadOrigin: string | null = null;

  const post = (data: unknown, targetOrigin: string) => {
    if (!targetOrigin || targetOrigin === '*') return; // never "*" (A44)
    parentWindow.postMessage(data, targetOrigin);
  };

  const onMessage = (event: MessageEvent) => {
    // The origin gate: a non-allow-listed sender is ignored SILENTLY —
    // no reply, no content logging, nothing inspected.
    const target = replyTargetFor(event.origin, allowList);
    if (!target) return;
    const data = event.data as unknown;
    if (typeof data === 'object' && data !== null && (data as { type?: unknown }).type === HOST_MSG_LOAD_IMAGE) {
      const verdict = validateHostLoadImage(data, event.origin, allowList);
      if (verdict.kind === 'accepted') {
        lastLoadOrigin = event.origin;
        opts.handlers.onLoadImage(verdict.file, verdict.requestId);
      } else {
        // A message from an ALLOW-LISTED origin that is malformed or
        // oversized gets an explicit error (the host can fix it); the
        // requestId is echoed when the message carried a usable one.
        const requestId =
          typeof (data as { requestId?: unknown }).requestId === 'string' &&
          ((data as { requestId: string }).requestId.length ?? 0) > 0 &&
          ((data as { requestId: string }).requestId.length ?? 0) <= MAX_REQUEST_ID
            ? (data as { requestId: string }).requestId
            : '';
        post({ type: HOST_MSG_ERROR, requestId, code: verdict.why }, event.origin);
      }
    }
    // Anything else (unknown types from an allow-listed origin) is
    // ignored too — the contract has exactly four messages.
  };

  win.addEventListener('message', onMessage);

  // Announce the bridge to every allow-listed origin on boot (A45).
  for (const origin of allowList) {
    post({ type: HOST_MSG_READY }, origin);
  }

  return {
    allowList,
    embedded,
    reportResult(requestId: string, text: string) {
      const target = lastLoadOrigin;
      if (!target) return; // nothing to correlate — nothing leaves
      post({ type: HOST_MSG_RESULT, requestId, text }, target);
    },
    reportError(requestId: string, code: HostErrorCode) {
      const target = lastLoadOrigin;
      if (!target) return;
      post({ type: HOST_MSG_ERROR, requestId, code }, target);
    },
    destroy() {
      win.removeEventListener('message', onMessage);
    },
  };
}
