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
 *  (anything else is dropped, never coerced or guessed). Lives in the
 *  GREEN implementation; the RED scaffold parses nothing. */

/**
 * SCAFFOLD (RED, R2-2): the typed contract surface exists so the suite
 * fails BEHAVIOURALLY on the real assertions (not import errors); the
 * bodies are fail-closed stubs. The GREEN implementation replaces them.
 */
export function parseHostOrigins(param: string | null | undefined): string[] {
  void param;
  return [];
}

export function hostAllowList(
  envValue: string | undefined,
  queryParam: string | null | undefined,
): string[] {
  void envValue;
  void queryParam;
  return [];
}

export function validateHostLoadImage(
  data: unknown,
  origin: string,
  allowList: readonly string[],
): HostLoadImageVerdict {
  void data;
  void origin;
  void allowList;
  void MAX_REQUEST_ID; // the GREEN validation enforces the requestId bound
  return { kind: 'ignored', why: 'bad-message' };
}

/** The reply target for a message that came from `origin`: the origin
 *  itself when allow-listed, else null (never "*", never a guess). */
export function replyTargetFor(origin: string, allowList: readonly string[]): string | null {
  void origin;
  void allowList;
  return null;
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
  void opts;
  return null;
}
