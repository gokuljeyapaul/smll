/**
 * The main-thread client for the model-cleanup Worker (S4). One cleanup at
 * a time; the pipeline's own timeout guards hangs. If the worker dies
 * (a wasm abort kills the thread), the client fails closed: every pending
 * and FUTURE call resolves as a runtime-error fallback — the app keeps the
 * deterministic cleanup and says so (plan point 4), never a silent gap.
 */

import type { CleanupOutcome } from './pipeline';
import type { WorkerRequest, WorkerResponse } from './worker';

export interface ClientResult {
  outcome: CleanupOutcome;
  /** Non-user debug detail (worker error message); never post text. */
  detail?: string;
}

interface Pending {
  resolve: (result: ClientResult) => void;
}

export class LlmCleanupClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private broken = false;

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
      const { type, id, outcome, detail } = event.data;
      if (type !== 'result') return;
      const pending = this.pending.get(id);
      this.pending.delete(id);
      pending?.resolve({ outcome, detail });
    });
    worker.addEventListener('error', () => {
      this.failAll('the cleanup worker crashed');
    });
    worker.addEventListener('messageerror', () => {
      this.failAll('the cleanup worker received an unserializable message');
    });
    this.worker = worker;
    return worker;
  }

  /** Fail closed: reject nothing (the app treats it as a fallback), just
   *  resolve every pending request as a runtime error and disable the
   *  worker for the rest of the session. */
  private failAll(why: string): void {
    this.broken = true;
    this.worker?.terminate();
    this.worker = null;
    console.warn(`postclip: model-cleanup worker failed (${why}); falling back to the standard cleanup`);
    for (const [, pending] of this.pending) {
      pending.resolve({
        outcome: { kind: 'fallback', reason: 'runtime-error', latencyMs: 0 },
        detail: 'worker-unavailable',
      });
    }
    this.pending.clear();
  }

  /** Run one model cleanup. Resolves ONLY with a designed outcome: either
   *  a guard-passed model result or an explicit fallback — never throws. */
  async cleanup(lines: string[]): Promise<ClientResult> {
    if (this.broken) {
      return {
        outcome: { kind: 'fallback', reason: 'runtime-error', latencyMs: 0 },
        detail: 'worker-unavailable',
      };
    }
    const worker = this.ensureWorker();
    const id = this.nextId++;
    return new Promise<ClientResult>((resolve) => {
      this.pending.set(id, { resolve });
      const request: WorkerRequest = { type: 'cleanup', id, lines };
      worker.postMessage(request);
    });
  }
}

/** The app's single client instance (the worker outlives picks; the model
 *  loads once per session and prompt caching speeds the eval loop). */
export const llmCleanupClient = new LlmCleanupClient();
