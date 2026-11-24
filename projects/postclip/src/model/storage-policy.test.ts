// @vitest-environment node
/**
 * R2-3 (A38, plan S9): the storage-offer decision logic and the cheap
 * fresh-start cache check — pure, table-pinned unit tests. RED-first: on
 * the scaffolded (unwired) module every behavioural assertion fails.
 */
import { describe, expect, it } from 'vitest';
import {
  type CacheCheckFacts,
  ROOM_HEADROOM_FACTOR,
  STORAGE_REFUSAL_MESSAGES,
  type StorageFacts,
  decideStorageOffer,
  formatMiB,
  planCacheCheck,
  roomBarBytes,
} from './storage-policy';
import { PINNED_MODEL } from './manifest';

const NEEDED = PINNED_MODEL.sizeBytes; // the real pinned 396,705,472 bytes
const ROOM = roomBarBytes(NEEDED);

/** The measured matrix quotas (docs/evidence/R2-3/env-probe.json):
 * Chromium reports 10 GiB, WebKit 1 GiB — both must be OFFERED. */
const CHROMIUM_QUOTA = 10_737_418_240;
const WEBKIT_QUOTA = 1_073_741_824;

function facts(over: Partial<StorageFacts> = {}): StorageFacts {
  return { probeOk: true, quotaBytes: CHROMIUM_QUOTA, cacheWasLost: false, ...over };
}

function cacheFacts(over: Partial<CacheCheckFacts> = {}): CacheCheckFacts {
  return { sizeMatches: true, markerPresent: true, markerMatches: true, ...over };
}

describe('storage-offer decision (R2-3, A38)', () => {
  it('a working store with room → offer (the measured matrix quotas both pass)', () => {
    expect(decideStorageOffer(facts(), NEEDED)).toBe('offer');
    expect(decideStorageOffer(facts({ quotaBytes: WEBKIT_QUOTA }), NEEDED)).toBe('offer');
    // quota unknown (estimate unsupported) + store works → still offer
    expect(decideStorageOffer(facts({ quotaBytes: null }), NEEDED)).toBe('offer');
  });

  it('no room → the no-room refusal (quota under the room bar)', () => {
    expect(decideStorageOffer(facts({ quotaBytes: ROOM - 1 }), NEEDED)).toBe('no-room');
    // barely fitting once is not enough: the promote peaks at temp + final
    expect(decideStorageOffer(facts({ quotaBytes: NEEDED + 1024 }), NEEDED)).toBe('no-room');
  });

  it('the room bar is the pinned size × the headroom factor (temp + final during promote)', () => {
    expect(ROOM_HEADROOM_FACTOR).toBe(2);
    expect(roomBarBytes(NEEDED)).toBe(NEEDED * 2);
  });

  it('a detected lost cache → volatile, even with room', () => {
    expect(decideStorageOffer(facts({ cacheWasLost: true }), NEEDED)).toBe('volatile');
  });

  it('no-room wins when both no-room and volatile apply (the actionable message first)', () => {
    expect(decideStorageOffer(facts({ quotaBytes: ROOM - 1, cacheWasLost: true }), NEEDED)).toBe('no-room');
  });

  it('a store that cannot even write/read → unavailable', () => {
    expect(decideStorageOffer(facts({ probeOk: false }), NEEDED)).toBe('unavailable');
  });

  it('the refusals are kind, exact, and name what still works', () => {
    const noRoom = STORAGE_REFUSAL_MESSAGES['no-room'];
    expect(noRoom).toContain(`about ${formatMiB(NEEDED)} MiB`);
    expect(noRoom).toContain("isn't enough room");
    expect(noRoom).toContain('Everything else still works');
    expect(noRoom).toContain('standard rules');
    const volatile = STORAGE_REFUSAL_MESSAGES.volatile;
    expect(volatile).toContain("clears the tidy-up model's storage");
    expect(volatile).toContain('private window');
    expect(volatile).toContain('Everything else still works');
    expect(volatile).toContain('standard rules');
  });

  it('the size label is computed from the pinned manifest (never a magic number)', () => {
    expect(formatMiB(PINNED_MODEL.sizeBytes)).toBe(
      (PINNED_MODEL.sizeBytes / (1024 * 1024)).toFixed(0),
    );
  });
});

describe('fresh-start cache check plan (R2-3, A37/A38)', () => {
  it('size + matching marker → trust (cheap: no 397 MB re-hash on launch)', () => {
    expect(planCacheCheck(cacheFacts())).toBe('trust');
  });

  it('size matches, marker missing → rehash once, then the marker makes it cheap', () => {
    expect(planCacheCheck(cacheFacts({ markerPresent: false }))).toBe('rehash');
  });

  it('a marker naming another pin or size → purge (stale, fail closed)', () => {
    expect(planCacheCheck(cacheFacts({ markerMatches: false }))).toBe('purge');
  });

  it('size mismatch → purge, marker or not', () => {
    expect(planCacheCheck(cacheFacts({ sizeMatches: false }))).toBe('purge');
    expect(planCacheCheck(cacheFacts({ sizeMatches: false, markerPresent: false }))).toBe('purge');
  });
});
