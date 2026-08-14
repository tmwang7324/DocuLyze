"use client";

import { useEffect, useRef, useState } from "react";
import { isTerminalDocStatus, type EnqueueOutcome } from "@/_lib/ingest_contract";
import router from "next/navigation";
// Pipeline progress view (issue #10): the byte-progress bar hands off, on
// finalize, into a step view — Uploading -> Queued -> Parsing -> Ready — driven
// by the per-document SSE stream. "Uploading" is local XHR progress (never in
// Firestore); every later step relays the record's status. The screen is a
// window, not a dependency: closing the tab never affects the pipeline.

const PATIENCE_MS = 60_000; // 3x the worker's 20s sandbox cap

// Wire vocabulary -> display step. Anything not listed here (a future
// `embedding`, say) renders as a generic in-progress step so adding a status
// is purely additive and old clients degrade gracefully.
const STEP_OF_STATUS: Record<string, number> = {
  uploaded: 1, // Queued
  processing: 2, // Parsing
  ready: 3, // past the last step — everything done
  failed: 2, // the parse step is what failed; it must not render as done
};

const STEP_LABELS = ["Uploading", "Queued", "Parsing"];

type Props = {
  docId: string;
  progress: number; // 0-100 local XHR progress
  enqueue: EnqueueOutcome | null; // null until finalize returns
  /** Fired once the record reaches a terminal status, so the screen's recent
   *  column can re-read it (issue #25). Optional: the pipeline view is a window
   *  onto the record, and it works exactly as before without a listener. */
  onSettled?: () => void;
};

export default function PipelineProgress({ docId, progress, enqueue, onSettled }: Props) {
  const [status, setStatus] = useState<string | null>(null);
  const [patience, setPatience] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  // Held in a ref, not in the effect's deps: the parent passes an inline
  // closure, and putting it in the dependency list would tear down and rebuild
  // the EventSource on every render of the parent.
  const onSettledRef = useRef(onSettled);
  useEffect(() => {
    onSettledRef.current = onSettled;
  });

  // `failed` enqueue means definitely-not-queued: no subscription at all.
  // `queued` and `unknown` both watch — `unknown` self-heals into Parsing if the envelope actually landed or the sweep republishes.

  // watching is not mutated in this component; it only gets its value as a prop in upload_form
  const watching = enqueue === "queued" || enqueue === "unknown";

  useEffect(() => {
    if (!watching)  // 
      return;
    setStatus(null);
    setPatience(false);
    const es = new EventSource(`/api/documents/${docId}/stream`);
    esRef.current = es;
    es.onmessage = (e) => {
      try {
        const { status: s } = JSON.parse(e.data) as { status: string };
        setStatus(s);
        // Terminal: the server ends the stream; close here too so EventSource
        // doesn't auto-reconnect against a finished pipeline.
        if (isTerminalDocStatus(s)) {
          es.close();
          onSettledRef.current?.();
        }
      } catch {
        // malformed frame — ignore; the next snapshot resyncs
      }
    };
    // No onerror handler on purpose: EventSource auto-reconnects, and the
    // server replays the current state as the first event on reconnect.
    return () => {
      es.close();
      esRef.current = null;
    };
  }, [docId, watching]);

  // Patience timer: reset on every observed transition. On expiry, stop
  // watching and reassure — eternal silence must never read as an infinite
  // spinner. Wording rule: never say "failed" when the truth is "delayed".
  useEffect(() => {
    if (!watching || (status !== null && isTerminalDocStatus(status))) 
      return;
    const t = setTimeout(() => {
      esRef.current?.close();
      setPatience(true);
    }, PATIENCE_MS);
    return () => clearTimeout(t);
  }, [watching, status]);

  const uploading = enqueue === null;
  const ready = status === "ready";
  const parseFailed = status === "failed";
  const terminal = ready || parseFailed;
  // A terminated screen (definite enqueue failure) or an expired patience
  // timer freezes the animation — nothing is actively being watched anymore.
  const halted = patience || enqueue === "failed";
  
  const knownStep = uploading ? 0 : STEP_OF_STATUS[status ?? "uploaded"]; // Before the first event arrives, the record is known-`uploaded` (finalize just wrote it), so the view starts at Queued rather than blank.
  const genericInProgress = knownStep === undefined; // unrecognized status
  const activeStep = genericInProgress ? STEP_LABELS.length : knownStep;

  // The design's notice treatment: an amber-toned aside for "delayed but safe",
  // the error token for a document that genuinely failed. Same four notices as
  // before, same wording rule — never say "failed" when the truth is "delayed".
  const NOTICE = "mt-5 border-l-2 px-4 py-3 text-sm";

  return (
    <div className="border border-hairline bg-white p-6" aria-live="polite">
      <div className="font-mono-label text-[10px] tracking-widest uppercase text-muted mb-5">
        Pipeline
      </div>

      <ol className="flex flex-col gap-px bg-hairline border border-hairline">
        {STEP_LABELS.map((label, i) => {
          // `ready` completes every step; `failed` marks the step it died on
          // (✕ on Parsing, never a green check on the thing that failed).
          let state: "done" | "failed" | "active" | "todo";
          if (i < activeStep || ready) {
            state = "done";
          } else if (i === activeStep) {
            if (parseFailed) { // Step failed due to parsing error
              state = "failed";
            } else if (halted) { // Screen is halted due to queue failure or expired patience timer
              state = "todo";
            } else {
              state = "active";
            }
          } else {
            state = "todo";
          }
          return (
            <li
              key={label}
              // One background class, chosen — not two stacked and left to the
              // stylesheet's ordering to resolve.
              className={`flex items-center gap-4 px-4 py-4 ${
                state === "active" ? "bg-orange-pale" : "bg-white"
              }`}
            >
              {/* The step's number, not a decorative bullet: the marker carries
                  the state, and the design's list markers are mono numerals. */}
              <span
                className={`font-mono-label text-[10px] tracking-wider w-6 shrink-0 ${
                  state === "done"
                    ? "text-ok"
                    : state === "failed"
                      ? "text-error"
                      : state === "active"
                        ? "text-orange-primary"
                        : "text-placeholder"
                }`}
                aria-hidden="true"
              >
                {state === "done" ? "✓" : state === "failed" ? "✕" : `0${i + 1}`}
              </span>

              <span
                className={`font-display text-lg uppercase leading-none ${
                  state === "done"
                    ? "font-bold text-ok"
                    : state === "failed"
                      ? "font-bold text-error"
                      : state === "active"
                        ? "font-bold text-dark"
                        : "font-medium text-placeholder"
                }`}
              >
                {label}
              </span>

              {/* Real XHR progress — the prototype's per-file bars were timers.
                  It shows only while the bytes are actually moving. */}
              {label === "Uploading" && state === "active" && (
                <span className="ml-auto flex items-center gap-3">
                  <span className="hidden sm:block h-1 w-28 bg-hairline" aria-hidden="true">
                    <span
                      className="block h-full bg-orange-primary transition-[width] duration-200"
                      style={{ width: `${progress}%` }}
                    />
                  </span>
                  <span className="font-mono-label text-[11px] tracking-wider text-orange-primary tabular-nums">
                    {progress.toFixed(0)}%
                  </span>
                </span>
              )}

              {label !== "Uploading" && state === "active" && (
                <span className="ml-auto font-mono-label text-[10px] tracking-wider uppercase text-orange-primary animate-pulse">
                  Working
                </span>
              )}
            </li>
          );
        })}

        {/* A status this build has never heard of renders as still-working — it
            must never read as finished. Same additive rule the archive follows. */}
        {genericInProgress && !terminal && !halted && (
          <li className="flex items-center gap-4 px-4 py-4 bg-orange-pale">
            <span className="font-mono-label text-[10px] tracking-wider w-6 shrink-0 text-orange-primary" aria-hidden="true">
              ●
            </span>
            <span className="font-display text-lg font-bold uppercase leading-none text-dark animate-pulse">
              Processing…
            </span>
          </li>
        )}

        {ready && (
          <li className="flex items-center gap-4 px-4 py-4 bg-white">
            <span className="font-mono-label text-[10px] tracking-wider w-6 shrink-0 text-ok" aria-hidden="true">
              ✓
            </span>
            <span className="font-display text-lg font-bold uppercase leading-none text-ok">
              Ready
            </span>
          </li>
        )}
      </ol>

      {enqueue === "failed" && (
        <p className={`${NOTICE} border-orange-primary bg-orange-pale text-dark`}>
          Upload saved — processing will be retried later. No need to re-upload.
        </p>
      )}
      {/* The warning clears once a transition past Queued proves the envelope
          landed — the self-heal must heal the wording, not just the steps. */}
      {enqueue === "unknown" && (status === null || status === "uploaded") && !patience && (
        <p className={`${NOTICE} border-orange-primary bg-orange-pale text-dark`}>
          Queue confirmation is delayed — still watching. Your document is safe.
        </p>
      )}
      {patience && !terminal && (
        <p className={`${NOTICE} border-orange-primary bg-orange-pale text-dark`}>
          Taking longer than expected — your document is safe and will keep
          processing. Check the dashboard later.
        </p>
      )}
      {ready && (
        <p className={`${NOTICE} border-ok bg-white text-dark`}>Your document is ready.</p>
      )}
      {parseFailed && (
        <p className={`${NOTICE} border-error bg-white text-dark`}>
          This file couldn&apos;t be processed — it may be corrupt or unsupported. Fix
          the file and upload again.
        </p>
      )}
    </div>
  );
}
