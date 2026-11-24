/**
 * The model status card (S3 — UC08/UC09): the home screen surface for the
 * model manager. Shows the one-time download affordance with LIVE progress
 * (A12), the ready badge, and — fail closed — an explicit, non-technical
 * banner whenever the model cannot be used, naming what the user still
 * gets (A13): everything works with the standard cleanup.
 *
 * The progress BAR is updated by writing the DOM directly from the manager
 * subscription (synchronous attribute/style writes): React batches state
 * updates from async loops, and in WebKit the whole 397 MiB download was
 * committed as ONE render — the bar sat at 0% and jumped to 100% without
 * ever visibly moving. Direct writes paint with the next frame in every
 * engine; the state-machine transitions (card states) still go through
 * React because they are low-frequency.
 */

import { useEffect, useRef, useState } from 'react';
import { modelManager, type ModelProgress } from '../model/manager';
import { PINNED_MODEL } from '../model/manifest';
import type { ModelFailReason } from '../model/state';
import { STORAGE_REFUSAL_MESSAGES, storageVolatileSignal } from '../model/storage-policy';

export interface ModelStatusCardProps {
  onDownload: () => void;
}

const MIB = 1024 * 1024;
const SIZE_LABEL = `${(PINNED_MODEL.sizeBytes / MIB).toFixed(1)} MiB`;

/** Non-technical, kind, and explicit about what still works (UC09). The
 * R2-3 refusals (no-room) come from the storage policy's exact messages. */
const BANNERS: Record<ModelFailReason, string> = {
  'checksum-mismatch':
    "The tidy-up model didn't pass its integrity check, so it wasn't kept. Everything else still works — pick your screenshot and PostClip cleans it up with the standard rules.",
  'size-mismatch':
    "The tidy-up model didn't finish downloading correctly, so it wasn't kept. Everything else still works — pick your screenshot and PostClip cleans it up with the standard rules.",
  'http-error':
    "The tidy-up model could not be reached right now, so it wasn't kept. Everything else still works — pick your screenshot and PostClip cleans it up with the standard rules.",
  'network-error':
    "The tidy-up model couldn't finish downloading on this network, so it wasn't kept. Everything else still works — pick your screenshot and PostClip cleans it up with the standard rules.",
  'storage-error':
    "The tidy-up model couldn't be saved on this device, so it wasn't kept. Everything else still works — pick your screenshot and PostClip cleans it up with the standard rules.",
  'no-room': STORAGE_REFUSAL_MESSAGES['no-room'],
  unsupported:
    "This browser can't run the tidy-up model, so PostClip uses the standard cleanup. Everything else works — pick your screenshot as usual.",
};

export function ModelStatusCard({ onDownload }: ModelStatusCardProps) {
  const [progress, setProgress] = useState<ModelProgress>(modelManager.getStatus());
  const trackRef = useRef<HTMLDivElement | null>(null);
  const fillRef = useRef<HTMLDivElement | null>(null);
  const labelRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const unsubscribe = modelManager.subscribe((p) => {
      // High-frequency progress: direct DOM writes, no React batching —
      // the bar must visibly MOVE during the download in every engine.
      const pct = p.totalBytes > 0 ? Math.min(100, (p.receivedBytes / p.totalBytes) * 100) : 0;
      const track = trackRef.current;
      if (track && fillRef.current) {
        fillRef.current.style.width = `${pct}%`;
        track.setAttribute('aria-valuenow', String(Math.round(pct)));
        track.setAttribute(
          'aria-valuetext',
          `${(p.receivedBytes / MIB).toFixed(1)} of ${(p.totalBytes / MIB).toFixed(1)} MiB`,
        );
      }
      if (labelRef.current) {
        labelRef.current.textContent = `${(p.receivedBytes / MIB).toFixed(1)}`;
      }
      setProgress(p); // state-machine transitions still go through React
    });
    return unsubscribe;
  }, []);

  const { state, receivedBytes, totalBytes, reason } = progress;
  const pct = totalBytes > 0 ? Math.min(100, Math.round((receivedBytes / totalBytes) * 100)) : 0;

  // R2-3 (A40): the READY state is owned by the Home screen (the small
  // "ready (cached)" line); this card handles everything else.

  if (state === 'downloading' || state === 'verifying') {
    return (
      <div className="model-progress-block" aria-live="polite">
        <p className="model-progress-label" id="model-progress-label">
          {state === 'verifying' ? (
            'Checking the download…'
          ) : (
            <>
              Downloading the tidy-up model… <span ref={labelRef}>{(receivedBytes / MIB).toFixed(1)}</span>
              {' of '}
              {(totalBytes / MIB).toFixed(1)} MiB
            </>
          )}
        </p>
        <div
          id="model-progress"
          className="progress-track"
          role="progressbar"
          aria-labelledby="model-progress-label"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuetext={`${(receivedBytes / MIB).toFixed(1)} of ${(totalBytes / MIB).toFixed(1)} MiB`}
          ref={trackRef}
        >
          <div className="progress-fill" ref={fillRef} style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  }

  if (state === 'failed' || state === 'unsupported') {
    return (
      <div className="model-banner" id="model-banner" role="alert">
        <p>{reason !== null ? BANNERS[reason] : BANNERS['network-error']}</p>
        {state === 'failed' ? (
          <button
            type="button"
            className="btn btn-secondary"
            id="model-retry-btn"
            onClick={onDownload}
          >
            Try downloading again
          </button>
        ) : null}
      </div>
    );
  }

  // state === 'absent': the one-time download affordance (UC08) — OPT-IN
  // since R2-3, reached only inside the Advanced section. When the storage
  // reports it cannot keep the model (the volatile signal), the kind
  // explanation replaces the offer: no 397 MB download that will be lost.
  if (storageVolatileSignal()) {
    return (
      <div className="model-banner" id="model-banner" role="alert">
        <p>{STORAGE_REFUSAL_MESSAGES.volatile}</p>
      </div>
    );
  }

  return (
    <section className="model-card" aria-labelledby="model-card-title">
      <h2 className="model-card-title" id="model-card-title">
        Optional: tidier cleanup
      </h2>
      <p className="model-card-text">
        Download the tidy-up model once ({SIZE_LABEL}) and your posts get a
        nicer cleanup — after that it works entirely offline.
      </p>
      <button
        type="button"
        className="btn btn-secondary"
        id="model-download-btn"
        onClick={onDownload}
      >
        Download tidy-up model ({SIZE_LABEL})
      </button>
    </section>
  );
}
