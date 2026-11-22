/**
 * Image validation and downscale (S1, A07): a cheap byte-level sniff of the
 * file header decides the input class BEFORE OCR ever runs — non-image,
 * corrupt, tiny — and huge images are downscaled before OCR.
 *
 * The sniff parses real PNG/JPEG/GIF/BMP/WebP headers (width/height only);
 * full decode (createImageBitmap, in App.tsx) happens next and catches
 * truncated streams the header cannot (corrupt01.png has a valid PNG
 * header and a garbage stream).
 */

export type ImageErrorCode = 'non-image' | 'corrupt' | 'tiny';

/** Images smaller than this cannot carry readable post text. */
export const MIN_IMAGE_DIM = 100;

/** Images larger than this on their longest side are downscaled before OCR. */
export const MAX_OCR_SIDE = 2600;

/** The user-facing error messages (the app shows them verbatim; the e2e
 *  flow asserts them). Each input class gets its own specific message. */
export const ERROR_MESSAGES: Record<ImageErrorCode, string> = {
  'non-image':
    "That file does not look like an image. Please choose a PNG or JPEG screenshot of a post.",
  corrupt:
    'That image file appears to be damaged or incomplete, so it could not be opened. Try saving the screenshot again.',
  tiny: `That image is too small to read. PostClip needs a screenshot of at least ${MIN_IMAGE_DIM}×${MIN_IMAGE_DIM} pixels.`,
};

/** The informational note shown when a huge image was downscaled. */
export const DOWNSCALE_NOTE = 'Large image: downscaled before reading.';

export type ImageKind = 'png' | 'jpeg' | 'gif' | 'bmp' | 'webp';

export interface ImageHeader {
  kind: ImageKind;
  width: number;
  height: number;
}

export interface DownscalePlan {
  needed: boolean;
  width: number;
  height: number;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(bytes: Uint8Array, prefix: number[]): boolean {
  return prefix.length <= bytes.length && prefix.every((b, i) => bytes[i] === b);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

/** Parse the image header: kind + dimensions, or null when the bytes carry
 *  no recognizable image magic. Header-only by design — a structurally
 *  valid header does NOT mean a decodable image. */
export function sniffImageHeader(bytes: Uint8Array): ImageHeader | null {
  if (bytes.length < 10) return null;

  if (startsWith(bytes, PNG_SIGNATURE)) {
    if (bytes.length < 24 || ascii(bytes, 12, 4) !== 'IHDR') return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16);
    const height = view.getUint32(20);
    if (width === 0 || height === 0) return null;
    return { kind: 'png', width, height };
  }

  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    // JPEG: scan segments for a start-of-frame marker; height then width.
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) return null;
      const marker = bytes[offset + 1];
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
        offset += 2;
        continue;
      }
      const length = view.getUint16(offset + 2);
      if ((marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)) {
        if (offset + 9 >= bytes.length) return null;
        const height = view.getUint16(offset + 5);
        const width = view.getUint16(offset + 7);
        if (width === 0 || height === 0) return null;
        return { kind: 'jpeg', width, height };
      }
      if (length <= 0) return null;
      offset += 2 + length;
    }
    return null;
  }

  if (ascii(bytes, 0, 3) === 'GIF') {
    const sig = ascii(bytes, 0, 6);
    if (sig !== 'GIF87a' && sig !== 'GIF89a') return null;
    const width = bytes[6] | (bytes[7] << 8);
    const height = bytes[8] | (bytes[9] << 8);
    if (width === 0 || height === 0) return null;
    return { kind: 'gif', width, height };
  }

  if (bytes[0] === 0x42 && bytes[1] === 0x4d && bytes.length >= 26) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getInt32(18, true);
    const height = Math.abs(view.getInt32(22, true));
    if (width <= 0 || height <= 0) return null;
    return { kind: 'bmp', width, height };
  }

  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    const format = ascii(bytes, 12, 4);
    if (format === 'VP8X' && bytes.length >= 30) {
      const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
      const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
      return { kind: 'webp', width, height };
    }
    if (format === 'VP8 ' && bytes.length >= 30) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const width = view.getUint16(26, true);
      const height = view.getUint16(28, true);
      if (width === 0 || height === 0) return null;
      return { kind: 'webp', width, height };
    }
    if (format === 'VP8L' && bytes.length >= 25) {
      const bits =
        bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
      const width = (bits & 0x3fff) + 1;
      const height = ((bits >> 14) & 0x3fff) + 1;
      return { kind: 'webp', width, height };
    }
    return null;
  }

  return null;
}

/** Compute the target size for OCR: never upscale; downscale so the
 *  longest side fits MAX_OCR_SIDE, preserving the aspect ratio. */
export function planDownscale(width: number, height: number): DownscalePlan {
  const longest = Math.max(width, height);
  if (longest <= MAX_OCR_SIDE) {
    return { needed: false, width, height };
  }
  const scale = MAX_OCR_SIDE / longest;
  return {
    needed: true,
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Downscale a decoded bitmap to the planned size and return a PNG blob for
 *  OCR. Uses OffscreenCanvas (both target engines support it; the huge
 *  fixture flow proves it end to end in Chromium and WebKit). */
export async function downscaleToPngBlob(
  bitmap: ImageBitmap,
  width: number,
  height: number,
): Promise<Blob> {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('could not acquire a 2d context to downscale');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, width, height);
  return canvas.convertToBlob({ type: 'image/png' });
}
