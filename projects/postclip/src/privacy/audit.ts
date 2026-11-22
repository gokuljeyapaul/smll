/**
 * Privacy audit helpers (S1, A15): the no-storage design says only the
 * app-shell cache and the model cache may ever persist anything — never
 * post text, in any storage, URL, cookie, console output or network
 * request. auditStorageSnapshot() judges a REAL snapshot collected from a
 * live page against that allow-list (pure logic, shared by the vitest
 * unit tests and the Playwright audits after every flow); redactText()
 * keeps known post text out of error strings.
 */

export interface StorageSnapshot {
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
  /** null when IndexedDB enumeration is unavailable in this browser build. */
  indexedDatabaseNames: string[] | null;
  cacheNames: string[];
  cookies: string[];
  url: string;
  referrer: string;
}

export interface StorageViolation {
  where: string;
  detail: string;
}

export interface StorageAuditReport {
  violations: StorageViolation[];
  notes: string[];
}

/** Only these cache names may ever exist (app-shell precache from the S2
 *  service worker; the model cache from S3). S1 asserts an empty set. */
export const ALLOWED_CACHE_NAME_PATTERNS: RegExp[] = [
  /^workbox-precache/,
  /^precache/,
  /^postclip-model/,
];

import { tokenize } from '../cleanup/metrics';
import { ENGLISH_STOPWORDS } from '../language/gate';

/** Distinctive tokens for leak scans: >= 6 chars, not an English stopword,
 *  deduplicated, lowercased. Long enough that browser/CDP noise never
 *  false-positives, short enough to catch any real copy of the post. */
export function distinctiveTokens(text: string): string[] {
  return [...new Set(tokenize(text).filter((t) => t.length >= 6 && !ENGLISH_STOPWORDS.has(t)))];
}

export function auditStorageSnapshot(
  snapshot: StorageSnapshot,
  forbiddenTokens: string[],
): StorageAuditReport {
  const violations: StorageViolation[] = [];
  const notes: string[] = [];
  const tokens = forbiddenTokens.map((t) => t.toLowerCase()).filter((t) => t.length > 0);

  /** The first forbidden token found in a value, if any. */
  const hit = (value: string): string | undefined => {
    const v = value.toLowerCase();
    return tokens.find((t) => v.includes(t));
  };

  const stores: [string, Record<string, string>][] = [
    ['localStorage', snapshot.localStorage],
    ['sessionStorage', snapshot.sessionStorage],
  ];
  for (const [where, store] of stores) {
    for (const [key, value] of Object.entries(store)) {
      const token = hit(`${key} ${value}`);
      if (token) {
        violations.push({ where, detail: `post text "${token}" found in ${where} key "${key}"` });
      } else {
        violations.push({
          where,
          detail: `${where} entry "${key}" is not on the allow-list (no app storage is allowed)`,
        });
      }
    }
  }

  if (snapshot.indexedDatabaseNames === null) {
    notes.push('IndexedDB enumeration unavailable in this browser build; not audited.');
  } else {
    for (const name of snapshot.indexedDatabaseNames) {
      const token = hit(name);
      violations.push({
        where: 'IndexedDB',
        detail: token
          ? `post text "${token}" found in IndexedDB name "${name}"`
          : `IndexedDB database "${name}" is not on the allow-list`,
      });
    }
  }

  for (const name of snapshot.cacheNames) {
    if (!ALLOWED_CACHE_NAME_PATTERNS.some((p) => p.test(name))) {
      violations.push({ where: 'cache storage', detail: `cache "${name}" is not on the allow-list` });
    }
  }

  for (const cookie of snapshot.cookies) {
    const token = hit(cookie);
    violations.push({
      where: 'cookies',
      detail: token
        ? `post text "${token}" found in cookie "${cookie}"`
        : `cookie "${cookie}" is not allowed (the app sets no cookies)`,
    });
  }

  const urlToken = hit(snapshot.url);
  if (urlToken) {
    violations.push({ where: 'url', detail: `post text "${urlToken}" found in the page URL` });
  }
  const referrerToken = hit(snapshot.referrer);
  if (referrerToken) {
    violations.push({ where: 'referrer', detail: `post text "${referrerToken}" found in the referrer` });
  }

  return { violations, notes };
}

/** Replace any occurrence of the given secret texts — or any run of 3+
 *  consecutive of their words — in a message with '[redacted]'. */
export function redactText(message: string, secrets: string[]): string {
  let out = message;
  for (const secret of secrets) {
    if (!secret || secret.trim().length === 0) continue;
    out = out.split(secret).join('[redacted]');
    const words = secret
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w.replace(/[.,;:!?…]+$/g, ''));
    for (let i = 0; i + 2 < words.length; i++) {
      for (let j = i + 3; j <= words.length; j++) {
        const fragment = words.slice(i, j).join(' ');
        if (fragment.length >= 12) {
          out = out.split(fragment).join('[redacted]');
        }
      }
    }
  }
  return out;
}
