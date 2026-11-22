/**
 * Shared e2e privacy-audit helpers (A15): capture console messages and
 * network requests during a flow, collect the REAL browser storage state,
 * and judge it with the same pure audit logic the vitest suite tests
 * (src/privacy/audit.ts). Runs after every S1 flow.
 */
import type { Page } from '@playwright/test';
import {
  auditStorageSnapshot,
  distinctiveTokens,
  type StorageSnapshot,
  type StorageViolation,
} from '../../src/privacy/audit';

export interface FlowCapture {
  consoleMessages: string[];
  requests: { url: string; method: string; postData: string | null }[];
}

export function startCapture(page: Page): FlowCapture {
  const capture: FlowCapture = { consoleMessages: [], requests: [] };
  page.on('console', (m) => capture.consoleMessages.push(m.text()));
  page.on('pageerror', (e) => capture.consoleMessages.push(`pageerror: ${String(e)}`));
  page.on('request', (r) =>
    capture.requests.push({ url: r.url(), method: r.method(), postData: r.postData() ?? null }),
  );
  return capture;
}

export async function collectStorageSnapshot(page: Page): Promise<StorageSnapshot> {
  return page.evaluate(async () => {
    const ls: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) ?? `unnamed-${i}`;
      ls[k] = localStorage.getItem(k) ?? '';
    }
    const ss: Record<string, string> = {};
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i) ?? `unnamed-${i}`;
      ss[k] = sessionStorage.getItem(k) ?? '';
    }
    let indexedDatabaseNames: string[] | null = null;
    if (typeof indexedDB !== 'undefined' && typeof indexedDB.databases === 'function') {
      try {
        indexedDatabaseNames = (await indexedDB.databases()).map((d) => d.name ?? '');
      } catch {
        indexedDatabaseNames = null;
      }
    }
    let cacheNames: string[] = [];
    try {
      if (typeof caches !== 'undefined') cacheNames = await caches.keys();
    } catch {
      cacheNames = [];
    }
    return {
      localStorage: ls,
      sessionStorage: ss,
      indexedDatabaseNames,
      cacheNames,
      cookies: document.cookie ? document.cookie.split(';').map((c) => c.trim()) : [],
      url: location.href,
      referrer: document.referrer,
    };
  });
}

export interface AuditOutcome {
  violations: StorageViolation[];
  notes: string[];
  requestCount: number;
  consoleMessageCount: number;
  crossOriginRequests: string[];
  cacheNames: string[];
  indexedDatabaseNames: string[] | null;
}

/** Run the full A15 audit after a flow: storage allow-list + forbidden-token
 *  scan across storage/URL/console/network + same-origin-only requests. */
export async function runPrivacyAudit(
  page: Page,
  capture: FlowCapture,
  forbiddenTexts: string[],
): Promise<AuditOutcome> {
  const tokens = [...new Set(forbiddenTexts.flatMap((t) => distinctiveTokens(t)))];
  const snapshot = await collectStorageSnapshot(page);
  const report = auditStorageSnapshot(snapshot, tokens);

  const violations = [...report.violations];
  const notes = [...report.notes];
  const origin = new URL(page.url()).origin;

  const crossOriginRequests = capture.requests
    .filter((r) => {
      try {
        const u = new URL(r.url);
        return u.protocol !== 'blob:' && u.origin !== origin;
      } catch {
        return false;
      }
    })
    .map((r) => r.url);
  if (crossOriginRequests.length > 0) {
    violations.push({ where: 'network', detail: `cross-origin requests: ${crossOriginRequests.join(', ')}` });
  }

  const tokenInRequests = capture.requests.filter((r) =>
    tokens.some((t) => r.url.toLowerCase().includes(t) || (r.postData ?? '').toLowerCase().includes(t)),
  );
  if (tokenInRequests.length > 0) {
    violations.push({
      where: 'network',
      detail: `post text in request URLs or bodies: ${tokenInRequests.map((r) => r.url).join(', ')}`,
    });
  }

  const tokenInConsole = capture.consoleMessages.filter((m) =>
    tokens.some((t) => m.toLowerCase().includes(t)),
  );
  if (tokenInConsole.length > 0) {
    violations.push({ where: 'console', detail: `post text in console output: ${tokenInConsole.join(' | ')}` });
  }

  return {
    violations,
    notes,
    requestCount: capture.requests.length,
    consoleMessageCount: capture.consoleMessages.length,
    crossOriginRequests,
    cacheNames: snapshot.cacheNames,
    indexedDatabaseNames: snapshot.indexedDatabaseNames,
  };
}
