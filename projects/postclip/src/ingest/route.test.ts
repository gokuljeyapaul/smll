// @vitest-environment node
/**
 * Input routing (S2, A08/A09/A10, host): every input channel hands the
 * pipeline a well-formed image File or fails closed with a specific message.
 * These are the RED-first behavioral tests for src/ingest/route.ts (the
 * assertions describe the S2 behavior; the scaffold fails them).
 */
import { describe, expect, it } from 'vitest';
import {
  CLIPBOARD_DENIED_MESSAGE,
  CLIPBOARD_READ_FAILED_MESSAGE,
  CLIPBOARD_UNAVAILABLE_MESSAGE,
  clipboardPermissionHint,
  clipboardReadErrorMessage,
  imageFileFromClipboardRead,
  imageFileFromDataTransferFiles,
  shareTargetFileFromMessage,
} from './route';

const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const pngFile = new File([pngBytes], 'shot.png', { type: 'image/png' });
const jpegFile = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'photo.jpg', { type: 'image/jpeg' });
const textFile = new File(['just some text'], 'note.txt', { type: 'text/plain' });

describe('imageFileFromDataTransferFiles — paste event routing (A09)', () => {
  it('returns the first image file from a paste event', () => {
    expect(imageFileFromDataTransferFiles([textFile, pngFile, jpegFile])).toBe(pngFile);
  });

  it('returns the only image when the paste carries several files', () => {
    expect(imageFileFromDataTransferFiles([jpegFile])).toBe(jpegFile);
  });

  it('returns null for a text-only paste so textarea pasting is never hijacked', () => {
    expect(imageFileFromDataTransferFiles([textFile])).toBeNull();
    expect(imageFileFromDataTransferFiles([])).toBeNull();
  });
});

describe('imageFileFromClipboardRead — Paste button routing (A09)', () => {
  it('picks the clipboard image and returns a named File', async () => {
    const items = [
      { types: ['text/plain'], getType: async () => new Blob(['text'], { type: 'text/plain' }) },
      {
        types: ['image/png'],
        getType: async () => new Blob([pngBytes], { type: 'image/png' }),
      },
    ];
    const file = await imageFileFromClipboardRead(items);
    expect(file).not.toBeNull();
    expect(file?.type).toBe('image/png');
    expect(file?.name.endsWith('.png')).toBe(true);
    expect(new Uint8Array(await file!.arrayBuffer())).toEqual(pngBytes);
  });

  it('returns null when the clipboard has no image (only text)', async () => {
    const items = [
      { types: ['text/plain'], getType: async () => new Blob(['text'], { type: 'text/plain' }) },
    ];
    expect(await imageFileFromClipboardRead(items)).toBeNull();
    expect(await imageFileFromClipboardRead([])).toBeNull();
  });

  it('propagates a getType failure instead of handing the pipeline half-read data', async () => {
    const items = [
      {
        types: ['image/png'],
        getType: async () => {
          throw new DOMException('read failed', 'NotFoundError');
        },
      },
    ];
    await expect(imageFileFromClipboardRead(items)).rejects.toThrow();
  });
});

describe('shareTargetFileFromMessage — service-worker message routing (A08)', () => {
  const blob = new Blob([pngBytes], { type: 'image/png' });

  it('turns a well-formed share-image message into the pipeline File', () => {
    const file = shareTargetFileFromMessage({
      type: 'postclip-share-image',
      name: 'shared.png',
      mime: 'image/png',
      blob,
    });
    expect(file).not.toBeNull();
    expect(file?.name).toBe('shared.png');
    expect(file?.type).toBe('image/png');
    expect(file?.size).toBe(blob.size);
  });

  it('keeps working when the OS share carried no filename (default name)', () => {
    const file = shareTargetFileFromMessage({
      type: 'postclip-share-image',
      name: '',
      mime: 'image/jpeg',
      blob: new Blob([new Uint8Array([0xff, 0xd8])], { type: 'image/jpeg' }),
    });
    expect(file).not.toBeNull();
    expect(file?.name.length).toBeGreaterThan(0);
  });

  it('fail closed: rejects wrong message types', () => {
    expect(
      shareTargetFileFromMessage({ type: 'postclip-navigation', name: 'x.png', mime: 'image/png', blob }),
    ).toBeNull();
    expect(shareTargetFileFromMessage({ name: 'x.png', mime: 'image/png', blob })).toBeNull();
    expect(shareTargetFileFromMessage('postclip-share-image')).toBeNull();
    expect(shareTargetFileFromMessage(null)).toBeNull();
  });

  it('fail closed: rejects a share without an image blob', () => {
    expect(
      shareTargetFileFromMessage({ type: 'postclip-share-image', name: 'x.png', mime: 'image/png' }),
    ).toBeNull();
    expect(
      shareTargetFileFromMessage({
        type: 'postclip-share-image',
        name: 'x.png',
        mime: 'image/png',
        blob: 'not-a-blob',
      }),
    ).toBeNull();
  });

  it('fail closed: rejects a non-image mime', () => {
    expect(
      shareTargetFileFromMessage({
        type: 'postclip-share-image',
        name: 'note.txt',
        mime: 'text/plain',
        blob: new Blob(['x'], { type: 'text/plain' }),
      }),
    ).toBeNull();
    expect(
      shareTargetFileFromMessage({ type: 'postclip-share-image', name: 'x', mime: '', blob }),
    ).toBeNull();
  });
});

describe('clipboardReadErrorMessage — permission states (A10)', () => {
  it('explains a DENIED clipboard-read with the file-picker path', () => {
    const msg = clipboardReadErrorMessage(new DOMException('denied', 'NotAllowedError'));
    expect(msg).toBe(CLIPBOARD_DENIED_MESSAGE);
    expect(msg).toContain('Choose screenshot');
  });

  it('explains an UNSUPPORTED clipboard with the file-picker path', () => {
    expect(clipboardReadErrorMessage(new DOMException('unsupported', 'NotSupportedError'))).toBe(
      CLIPBOARD_UNAVAILABLE_MESSAGE,
    );
    expect(clipboardReadErrorMessage(new TypeError('navigator.clipboard.read is not a function'))).toBe(
      CLIPBOARD_UNAVAILABLE_MESSAGE,
    );
  });

  it('never fails silent: unknown failures still get the fail-closed message', () => {
    expect(clipboardReadErrorMessage(new Error('boom'))).toBe(CLIPBOARD_READ_FAILED_MESSAGE);
    expect(clipboardReadErrorMessage(undefined)).toBe(CLIPBOARD_READ_FAILED_MESSAGE);
  });
});

describe('clipboardPermissionHint — proactive Paste-button hint (A10)', () => {
  it('warns when the permission state is known-denied', () => {
    const hint = clipboardPermissionHint('denied');
    expect(hint).toBe(CLIPBOARD_DENIED_MESSAGE);
  });

  it('stays quiet for granted, prompt and not-queryable states', () => {
    expect(clipboardPermissionHint('granted')).toBeNull();
    expect(clipboardPermissionHint('prompt')).toBeNull();
    expect(clipboardPermissionHint(null)).toBeNull();
  });
});
