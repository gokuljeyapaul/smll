// @vitest-environment node
/**
 * Embedded & hosting checks (R2-2, A42/A43/A46 — issue #79) that are pure
 * source/docs assertions:
 *
 *   A43 — the app never assumes a top-level page: no `window.top`, no
 *          popups (`window.open`, `opener`) anywhere in the shipped source
 *          (every embed-hostile API has a graceful fallback instead).
 *   A42 — the mobile-first layout facts the CSS must live up to: `100dvh`
 *          (never a bare `100vh` without the dvh line), safe-area insets,
 *          and a minimum 44px touch target for interactive elements; the
 *          viewport meta is keyboard-open friendly.
 *   A46 — docs/INTEGRATION.md is honest about the shipped contract: it
 *          names the exact message types, the size cap and the MIME
 *          allow-list the code enforces, the `frame-ancestors` HTTP header
 *          (a meta CSP cannot set it), and the storage-partitioning
 *          reality inside frames.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = join(ROOT, 'src');

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.css', '.html']);

/** Every shipped source file (tests excluded — they police, they are not
 *  the product). */
function shippedSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...shippedSources(full));
    } else if (SOURCE_EXTENSIONS.has(extname(full)) && !/\.(test|spec)\.[jt]sx?$/.test(full)) {
      out.push(full);
    }
  }
  return out;
}

describe('embedded behaviour source scan (R2-2, A43)', () => {
  it('never touches window.top, window.open or window.opener in shipped source', () => {
    const offenders: string[] = [];
    for (const file of shippedSources(SRC)) {
      const text = readFileSync(file, 'utf-8');
      // Comments may EXPLAIN the ban (e.g. "no window.top anywhere") and
      // strings may mention it; actual member access must not exist. Strip
      // string literals first, then comments, then match.
      const noStrings = text.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g, '');
      const noComments = noStrings
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
        .replace(/\/\/(?=.*$)/g, '');
      if (/window\s*\.\s*top\b/.test(noComments)) offenders.push(`${file}: window.top`);
      if (/window\s*\.\s*open\b/.test(noComments)) offenders.push(`${file}: window.open`);
      if (/\bopener\b/.test(noComments)) offenders.push(`${file}: window.opener`);
    }
    expect(offenders, `embed-hostile APIs found: ${offenders.join(', ')}`).toEqual([]);
  });
});

describe('mobile-first layout facts (R2-2, A42)', () => {
  const styles = readFileSync(join(SRC, 'styles.css'), 'utf-8');

  it('uses 100dvh for viewport-relative height (never a bare 100vh)', () => {
    expect(styles, 'the shell must size against the dynamic viewport').toMatch(/100dvh/);
    // Any 100vh present must be the progressive fallback on the line
    // before a 100dvh line — never the only height.
    const lines = styles.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (/100vh/.test(lines[i]) && !/dvh/.test(lines[i])) {
        const prev = i > 0 ? lines[i - 1] : '';
        expect(prev, `line ${i + 1} uses 100vh without a dvh fallback before it`).toMatch(/dvh/);
      }
    }
  });

  it('respects safe-area insets', () => {
    expect(styles).toMatch(/safe-area-inset/);
  });

  it('keeps a minimum 44px touch target on interactive elements', () => {
    expect(styles).toMatch(/min-height:\s*44px/);
  });

  it('keeps the viewport meta keyboard-open friendly (interactive-widget)', () => {
    const html = readFileSync(join(ROOT, 'index.html'), 'utf-8');
    expect(html).toMatch(/interactive-widget=resizes-content/);
  });
});

describe('INTEGRATION.md documents the shipped contract (R2-2, A46)', () => {
  const doc = readFileSync(join(ROOT, 'docs', 'INTEGRATION.md'), 'utf-8');
  const messaging = readFileSync(join(SRC, 'host', 'messaging.ts'), 'utf-8');

  it('names every message type the code ships', () => {
    for (const t of [
      'postclip:load-image',
      'postclip:ready',
      'postclip:result',
      'postclip:error',
    ]) {
      expect(doc, `INTEGRATION.md must document ${t}`).toContain(t);
      expect(messaging, `the code must define ${t}`).toContain(t);
    }
  });

  it('states the exact size cap the code enforces', () => {
    expect(doc).toContain('32 MiB');
    expect(messaging).toContain('32 * 1024 * 1024');
  });

  it('states the MIME allow-list the code enforces', () => {
    for (const mime of ['image/png', 'image/jpeg', 'image/webp']) {
      expect(doc, `INTEGRATION.md must list ${mime}`).toContain(mime);
    }
  });

  it('documents the frame-ancestors HTTP header (meta CSP cannot set it)', () => {
    expect(doc).toMatch(/frame-ancestors/);
    expect(doc).toMatch(/Content-Security-Policy/);
    expect(doc).toMatch(/cannot.{0,40}set.{0,40}frame-ancestors|meta CSP cannot/i);
  });

  it('gives a working example config for a static dist/', () => {
    expect(doc).toMatch(/example|nginx|Caddy|node/i);
  });

  it('documents the iframe allow=/sandbox recommendation', () => {
    expect(doc).toMatch(/allow=/);
    expect(doc).toMatch(/sandbox/);
  });

  it('states the storage-partitioning reality inside frames', () => {
    expect(doc).toMatch(/partition|ephemeral|wiped|wipe/i);
  });

  it('states the origin allow-list default (none accepted) and the never-"*" reply rule', () => {
    expect(doc).toMatch(/default.{0,60}none|none accepted/i);
    expect(doc).toContain('"*"');
  });
});
