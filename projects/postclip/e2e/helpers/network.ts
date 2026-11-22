/**
 * Shared e2e helper (S3 — A14): the request log that answers "did this flow
 * touch the network?".
 *
 * WHAT COUNTS AS A NETWORK REQUEST (documented, honest):
 *   - every `requestfailed` event: the browser tried to reach the wire and
 *     the network said no — while offline this is a network attempt;
 *   - every response with `fromServiceWorker() === false`: the response came
 *     through the browser's network stack, not from the worker's cache;
 *   - every request that produced neither a response nor a failure event by
 *     flush time (still in flight / unobservable) — counted as network
 *     (fail closed: an unobservable request must never read as offline).
 * WHAT DOES NOT:
 *   - responses with `fromServiceWorker() === true`: the service worker
 *     answered from its precache. No byte left the machine. (S2's a11 flow
 *     already asserts the offline shell is served exactly this way.)
 */
import type { Page, Request } from '@playwright/test';

export interface NetworkRequestEntry {
  url: string;
  method: string;
  /** 'net' (response not from the SW), 'failed' (requestfailed) or 'unknown'. */
  via: 'net' | 'failed' | 'unknown';
}

export interface NetworkLog {
  networkRequests: NetworkRequestEntry[];
  swServedCount: number;
  swServedUrls: string[];
}

export function startNetworkLog(page: Page): { flush: () => Promise<NetworkLog> } {
  const state = new Map<Request, { url: string; method: string; via: 'net' | 'failed' | 'unknown' | 'sw' }>();

  page.on('request', (r) => {
    state.set(r, { url: r.url(), method: r.method(), via: 'unknown' });
  });
  page.on('response', (r) => {
    const entry = state.get(r.request());
    if (entry) entry.via = r.fromServiceWorker() ? 'sw' : 'net';
  });
  page.on('requestfailed', (r) => {
    const entry = state.get(r);
    if (entry) entry.via = 'failed';
  });

  return {
    flush: async (): Promise<NetworkLog> => {
      // Let the browser settle: any request still pending after the flow's
      // final UI assertions has had time to produce a response or a failure.
      await page.waitForTimeout(500);
      const entries = [...state.values()];
      const swServedUrls = entries.filter((e) => e.via === 'sw').map((e) => e.url);
      const networkRequests: NetworkRequestEntry[] = entries
        .filter((e) => e.via !== 'sw')
        .map((e) => ({ url: e.url, method: e.method, via: e.via as 'net' | 'failed' | 'unknown' }));
      return {
        networkRequests,
        swServedCount: swServedUrls.length,
        swServedUrls: [...new Set(swServedUrls)],
      };
    },
  };
}

/** Render a NetworkLog as the human-readable evidence block (request log). */
export function formatNetworkLog(log: NetworkLog, title: string): string {
  const lines = [
    `# ${title}`,
    '',
    `network requests: ${log.networkRequests.length} (asserted ZERO for A14)`,
    `service-worker-served requests: ${log.swServedCount} (not network — see the definition in e2e/helpers/network.ts)`,
    '',
  ];
  if (log.networkRequests.length === 0) {
    lines.push('network request log: EMPTY');
  } else {
    for (const r of log.networkRequests) {
      lines.push(`- [${r.via}] ${r.method} ${r.url}`);
    }
  }
  if (log.swServedUrls.length > 0) {
    lines.push('', 'served by the service worker (precache, no wire):');
    for (const u of log.swServedUrls) lines.push(`- ${u}`);
  }
  lines.push('');
  return lines.join('\n');
}
