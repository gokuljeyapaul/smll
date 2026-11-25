// @vitest-environment jsdom
/**
 * The host messaging contract (R2-2, A44 — issue #79): pure, unit-tested
 * validation for everything that crosses the embedding boundary.
 *
 *   shape     — exactly the documented message (type, Blob/ArrayBuffer
 *               image, requestId string)
 *   size cap  — bounded (HOST_MAX_IMAGE_BYTES); larger is `too-large`
 *   mime      — the allow-list only; anything else `unsupported-mime`
 *   origin   — allow-list or ignored; the allow-list parses from the
 *               query param / build-time config and DEFAULTS TO EMPTY
 *   replies  — only to an allow-listed origin, NEVER "*"; non-allow-listed
 *               senders get nothing (and their content is never logged)
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HOST_ALLOWLIST_PARAM,
  HOST_MAX_IMAGE_BYTES,
  HOST_MIME_ALLOWLIST,
  HOST_MSG_ERROR,
  HOST_MSG_LOAD_IMAGE,
  HOST_MSG_READY,
  HOST_MSG_RESULT,
  createHostBridge,
  hostAllowList,
  parseHostOrigins,
  replyTargetFor,
  validateHostLoadImage,
  type HostLoadImageMessage,
} from './messaging';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const ALLOW = ['https://host.example.com', 'http://localhost:4199'];

function pngBlob(bytes = 1024): Blob {
  return new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' });
}

function loadMessage(overrides: Partial<HostLoadImageMessage> = {}): HostLoadImageMessage {
  return {
    type: HOST_MSG_LOAD_IMAGE,
    image: pngBlob(),
    mime: 'image/png',
    requestId: 'req-1',
    ...overrides,
  };
}

describe('host allow-list (R2-2, A44)', () => {
  it('defaults to EMPTY: nothing is accepted from other origins', () => {
    expect(parseHostOrigins(null)).toEqual([]);
    expect(parseHostOrigins('')).toEqual([]);
    expect(hostAllowList(undefined, null)).toEqual([]);
  });

  it('documents its query param name in docs/INTEGRATION.md', () => {
    const doc = readFileSync(join(ROOT, 'docs', 'INTEGRATION.md'), 'utf-8');
    expect(doc).toContain(HOST_ALLOWLIST_PARAM);
  });

  it('parses URL-encoded comma-separated origins from the query param', () => {
    expect(parseHostOrigins('https%3A%2F%2Fhost.example.com')).toEqual(['https://host.example.com']);
    expect(
      parseHostOrigins(encodeURIComponent('https://a.example,http://localhost:4199')),
    ).toEqual(['https://a.example', 'http://localhost:4199']);
  });

  it('drops invalid entries and normalizes to the origin (no path, no guess)', () => {
    expect(parseHostOrigins(encodeURIComponent('https://host.example.com/some/path'))).toEqual([
      'https://host.example.com',
    ]);
    expect(parseHostOrigins(encodeURIComponent('javascript:alert(1),,,about:blank'))).toEqual([]);
    expect(parseHostOrigins(encodeURIComponent('ftp://nope.example'))).toEqual([]);
  });

  it('merges build-time env origins with query-param origins, de-duplicated', () => {
    const merged = hostAllowList(
      'https://env.example,http://localhost:4199',
      encodeURIComponent('https://q.example,http://localhost:4199'),
    );
    expect(merged.sort()).toEqual(
      ['http://localhost:4199', 'https://env.example', 'https://q.example'].sort(),
    );
  });
});

describe('host load-image validation (R2-2, A44)', () => {
  it('accepts a well-formed message from an allow-listed origin', () => {
    const v = validateHostLoadImage(loadMessage(), 'https://host.example.com', ALLOW);
    expect(v.kind).toBe('accepted');
    if (v.kind !== 'accepted') return;
    expect(v.requestId).toBe('req-1');
    expect(v.file).toBeInstanceOf(File);
    expect(v.file.type).toBe('image/png');
  });

  it('accepts an ArrayBuffer image (wrapped into the same File)', () => {
    const v = validateHostLoadImage(
      loadMessage({ image: new ArrayBuffer(512) }),
      'https://host.example.com',
      ALLOW,
    );
    expect(v.kind).toBe('accepted');
    if (v.kind === 'accepted') expect(v.file.size).toBe(512);
  });

  it('ignores a message from a non-allow-listed origin — content untouched', () => {
    const data = loadMessage();
    const v = validateHostLoadImage(data, 'https://evil.example', ALLOW);
    expect(v).toEqual({ kind: 'ignored', why: 'bad-message' });
    // The image payload was never coerced or read for the reject path.
    expect(data.image).toBeInstanceOf(Blob);
  });

  it('rejects a non-allow-listed origin even for a perfect message (why: bad-message is never the origin leak)', () => {
    // The origin check MUST run before anything else — the why is the
    // generic reject; the content is not inspected or logged.
    const v = validateHostLoadImage(loadMessage(), 'http://localhost:4199', [
      'https://host.example.com',
    ]);
    expect(v.kind).toBe('ignored');
  });

  it('rejects the wrong type, missing fields and wrong shapes (why: bad-message)', () => {
    const cases: unknown[] = [
      null,
      'postclip:load-image',
      { type: 'postclip:load-image' }, // no image, no mime, no requestId
      { ...loadMessage(), type: 'postclip:something-else' },
      { ...loadMessage(), image: 'not-a-blob' },
      { ...loadMessage(), requestId: 42 },
      { ...loadMessage(), requestId: '' },
      { ...loadMessage(), requestId: 'x'.repeat(129) },
      [loadMessage()],
    ];
    for (const c of cases) {
      expect(validateHostLoadImage(c, 'https://host.example.com', ALLOW)).toEqual({
        kind: 'ignored',
        why: 'bad-message',
      });
    }
  });

  it(`rejects images over the ${HOST_MAX_IMAGE_BYTES} byte cap (why: too-large)`, () => {
    const big = loadMessage({ image: pngBlob(HOST_MAX_IMAGE_BYTES + 1) });
    expect(validateHostLoadImage(big, 'https://host.example.com', ALLOW)).toEqual({
      kind: 'ignored',
      why: 'too-large',
    });
    const edge = loadMessage({ image: pngBlob(HOST_MAX_IMAGE_BYTES) });
    expect(validateHostLoadImage(edge, 'https://host.example.com', ALLOW).kind).toBe('accepted');
  });

  it('rejects every mime outside the allow-list (why: unsupported-mime)', () => {
    for (const mime of ['image/gif', 'image/svg+xml', 'text/html', 'application/octet-stream', '']) {
      const v = validateHostLoadImage(
        loadMessage({ mime }),
        'https://host.example.com',
        ALLOW,
      );
      expect(v, `mime ${mime}`).toEqual({ kind: 'ignored', why: 'unsupported-mime' });
    }
    for (const mime of HOST_MIME_ALLOWLIST) {
      expect(
        validateHostLoadImage(loadMessage({ mime }), 'https://host.example.com', ALLOW).kind,
        `mime ${mime}`,
      ).toBe('accepted');
    }
  });
});

describe('host reply targets (R2-2, A44)', () => {
  it('replies only to an allow-listed origin, never "*"', () => {
    expect(replyTargetFor('https://host.example.com', ALLOW)).toBe('https://host.example.com');
    expect(replyTargetFor('https://evil.example', ALLOW)).toBeNull();
    expect(replyTargetFor('https://host.example.com', [])).toBeNull();
  });
});

describe('host bridge (R2-2, A44/A45)', () => {
  interface PostCall {
    data: unknown;
    targetOrigin: string;
  }

  function makeBridge(allowList: readonly string[], embedded = true) {
    const calls: PostCall[] = [];
    const listeners: ((e: MessageEvent) => void)[] = [];
    const win = {
      addEventListener: (_t: 'message', l: (e: MessageEvent) => void) => void listeners.push(l),
      removeEventListener: (_t: 'message', l: (e: MessageEvent) => void) => {
        const i = listeners.indexOf(l);
        if (i >= 0) listeners.splice(i, 1);
      },
    };
    const parent = {
      postMessage: (data: unknown, targetOrigin: string) => {
        calls.push({ data, targetOrigin });
      },
    };
    const onLoadImage = vi.fn();
    const bridge = createHostBridge({
      allowList,
      handlers: { onLoadImage },
      win,
      parent: embedded ? parent : undefined,
    });
    const message = (data: unknown, origin: string) => {
      for (const l of listeners) l(new MessageEvent('message', { data, origin }));
    };
    return { bridge, calls, onLoadImage, message, listeners, parent };
  }

  it('installs nothing with an empty allow-list (standalone usage unaffected)', () => {
    const b = makeBridge([]);
    expect(b.bridge).toBeNull();
    expect(b.calls).toEqual([]);
    expect(b.listeners).toHaveLength(0);
  });

  it('installs nothing when not embedded, even with an allow-list', () => {
    const b = makeBridge(['https://host.example.com'], false);
    expect(b.bridge).toBeNull();
  });

  it('posts postclip:ready to each allow-listed origin on boot', () => {
    const b = makeBridge(['https://host.example.com', 'http://localhost:4199']);
    expect(b.bridge).not.toBeNull();
    const readies = b.calls.filter((c) => (c.data as { type?: string }).type === HOST_MSG_READY);
    expect(readies.map((c) => c.targetOrigin).sort()).toEqual(
      ['https://host.example.com', 'http://localhost:4199'].sort(),
    );
    for (const c of readies) expect(c.targetOrigin).not.toBe('*');
  });

  it('a valid load-image from an allow-listed origin reaches the pipeline', () => {
    const b = makeBridge(['https://host.example.com']);
    b.message(loadMessage(), 'https://host.example.com');
    expect(b.onLoadImage).toHaveBeenCalledTimes(1);
    const [file, requestId] = b.onLoadImage.mock.calls[0];
    expect(file).toBeInstanceOf(File);
    expect(requestId).toBe('req-1');
  });

  it('a load-image from a NON-allow-listed origin is ignored — no reply, no handler call', () => {
    const b = makeBridge(['https://host.example.com']);
    const before = b.calls.length;
    b.message(loadMessage({ requestId: 'evil' }), 'https://evil.example');
    expect(b.onLoadImage).not.toHaveBeenCalled();
    expect(b.calls.slice(before)).toEqual([]);
  });

  it('a malformed load-image from an allow-listed origin gets a postclip:error (bad-message), still no content logging', () => {
    const b = makeBridge(['https://host.example.com']);
    b.message({ type: HOST_MSG_LOAD_IMAGE, image: null, mime: 'image/png', requestId: 'r2' }, 'https://host.example.com');
    expect(b.onLoadImage).not.toHaveBeenCalled();
    const errors = b.calls.filter((c) => (c.data as { type?: string }).type === HOST_MSG_ERROR);
    expect(errors).toHaveLength(1);
    expect(errors[0].data).toEqual({ type: HOST_MSG_ERROR, requestId: 'r2', code: 'bad-message' });
    expect(errors[0].targetOrigin).toBe('https://host.example.com');
  });

  it('reportResult replies to the origin the load came from (allow-listed), never "*"', () => {
    const b = makeBridge(['https://host.example.com', 'http://localhost:4199']);
    b.message(loadMessage({ requestId: 'r3' }), 'http://localhost:4199');
    b.bridge!.reportResult('r3', 'the extracted text');
    const results = b.calls.filter((c) => (c.data as { type?: string }).type === HOST_MSG_RESULT);
    expect(results).toHaveLength(1);
    expect(results[0].data).toEqual({ type: HOST_MSG_RESULT, requestId: 'r3', text: 'the extracted text' });
    expect(results[0].targetOrigin).toBe('http://localhost:4199');
    expect(results[0].targetOrigin).not.toBe('*');
  });

  it('reportResult before any load is a no-op (nothing to correlate, nothing leaves)', () => {
    const b = makeBridge(['https://host.example.com']);
    b.bridge!.reportResult('nope', 'never sent');
    expect(b.calls.filter((c) => (c.data as { type?: string }).type === HOST_MSG_RESULT)).toEqual([]);
  });

  it('destroy removes the listener (the bridge stops listening)', () => {
    const b = makeBridge(['https://host.example.com']);
    b.bridge!.destroy();
    expect(b.listeners).toHaveLength(0);
    b.message(loadMessage(), 'https://host.example.com');
    expect(b.onLoadImage).not.toHaveBeenCalled();
  });
});
