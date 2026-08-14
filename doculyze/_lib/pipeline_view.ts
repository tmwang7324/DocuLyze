// A document's pipeline state → what its row displays. (issue #26)
//
// Lifted out of components/pipeline_progress.tsx when the pipeline stopped being
// one panel below the dropzone and became part of every entry in the upload
// screen's recent column. The reason for the extraction is the same one the
// archive projection gives for its own: this is presentation logic with a
// failure mode that doesn't announce itself. A green check on the step a
// document died on, or a status this build has never heard of rendering as
// finished, is a normal-looking lie in a list that otherwise looks fine — and
// with up to five pipelines on screen at once there is no longer a single view
// you can verify by looking at it.
//
// Neutral module — no "use client", no "server-only" — for the same reason
// _lib/ingest_contract.ts is: the vocabulary is shared, and a second copy of it
// is how the row and the panel come to disagree about what a document is doing.
//
// It is presentation, never a gate: nothing here decides what happens to a
// document, only what the screen says about it.

import { isTerminalDocStatus, type EnqueueOutcome } from "@/_lib/ingest_contract";

export type StepState = "done" | "failed" | "active" | "todo";

export type PipelineStep = {
    label: string;
    state: StepState;
};

// The four things the screen can say, as tokens rather than prose — the wording
// lives with the markup, and this module stays testable without asserting on
// copy. Wording rule for whoever writes that copy: never say "failed" when the
// truth is "delayed".
export type PipelineNotice =
    | "enqueue-failed" // definitely not queued; the re-publish sweep owns recovery
    | "enqueue-unknown" // publish confirm timed out; the envelope may have landed
    | "patience" // nothing has moved for a long time, and that is not a failure
    | "ready"
    | "parse-failed";

// The record's journey after the bytes have landed. "Uploading" is deliberately
// not here: a record only exists once the PUT succeeded, so a row can never be
// in that step. The byte progress belongs to the form that owns the XHR.
export const PIPELINE_STEPS = ["Queued", "Parsing"] as const;

// Wire vocabulary → the step index the user is looking at. Anything absent from
// this map (a future `embedding`, say) renders as a generic in-progress step, so
// adding a status to the pipeline is purely additive and old clients degrade
// gracefully instead of claiming the document is done.
const STEP_OF_STATUS: Record<string, number> = {
    uploaded: 0, // Queued
    processing: 1, // Parsing
    ready: PIPELINE_STEPS.length, // past the last step — everything done
    failed: 1, // the parse step is what failed; it must not render as done
};

export type PipelineInput = {
    /** The record's status as currently known — from the archive projection on
     *  first render, then from the stream. */
    status: string;
    /** What finalize said about the enqueue, when this client is the one that
     *  uploaded the document. `null` for every other row: nothing is known, and
     *  nothing is claimed. */
    enqueue: EnqueueOutcome | null;
    /** The patience timer has run out — see PATIENCE_MS at the call site. */
    patienceExpired: boolean;
};

export type PipelineView = {
    steps: PipelineStep[];
    ready: boolean;
    parseFailed: boolean;
    /** A status this build doesn't recognise: render a generic working step. */
    genericInProgress: boolean;
    /** Nothing is being watched any more — freeze the animation. */
    halted: boolean;
    /** Whether this view should hold an EventSource open. */
    watch: boolean;
    notice: PipelineNotice | null;
};

export function pipelineView({ status, enqueue, patienceExpired }: PipelineInput): PipelineView {
    const ready = status === "ready";
    const parseFailed = status === "failed";
    const terminal = isTerminalDocStatus(status);

    // A definite enqueue failure or an expired patience timer means nothing is
    // actively being observed; a terminal record means there is nothing left to
    // observe. Both stop the animation, but only the first two are "halted" —
    // a finished document isn't stalled, it's finished.
    const halted = patienceExpired || enqueue === "failed";
    const watch = !terminal && !halted;

    const genericInProgress = STEP_OF_STATUS[status] === undefined;
    const activeStep = genericInProgress ? PIPELINE_STEPS.length : STEP_OF_STATUS[status];

    const steps: PipelineStep[] = PIPELINE_STEPS.map((label, i) => {
        // `ready` completes every step; `failed` marks the step it died on
        // (✕ on Parsing, never a green check on the thing that failed).
        let state: StepState;
        if (i < activeStep || ready) {
            state = "done";
        } else if (i === activeStep) {
            state = parseFailed ? "failed" : halted ? "todo" : "active";
        } else {
            state = "todo";
        }
        return { label, state };
    });

    return {
        steps,
        ready,
        parseFailed,
        genericInProgress,
        halted,
        watch,
        notice: noticeFor({ status, enqueue, patienceExpired }, { ready, parseFailed }),
    };
}

// Ordered, not stacked. The panel this replaced rendered its notices as
// independent conditions, which could put "processing will be retried later"
// directly above "your document is ready" — the enqueue outcome is a guess made
// at finalize time, and the record's terminal status is the only thing either
// end actually observed. Terminal truth wins.
function noticeFor(
    { status, enqueue, patienceExpired }: PipelineInput,
    { ready, parseFailed }: { ready: boolean; parseFailed: boolean },
): PipelineNotice | null {
    // Always: a failed document is a standing condition with something for the
    // user to do about it, whenever it was uploaded.
    if (parseFailed) return "parse-failed";
    // Only for the document this client just uploaded (`enqueue` is non-null for
    // exactly that one row). "Your document is ready" announces an arrival; a
    // column of five settled documents each repeating it announces nothing, and
    // the row's own ✓ Ready step already says so.
    if (ready) return enqueue === null ? null : "ready";
    if (enqueue === "failed") return "enqueue-failed";
    if (patienceExpired) return "patience";
    // The warning clears the moment a transition past Queued proves the envelope
    // landed: the self-heal has to heal the wording, not just the steps.
    if (enqueue === "unknown" && status === "uploaded") return "enqueue-unknown";
    return null;
}

/**
 * Reconcile the status the server rendered with the one a stream observed.
 *
 * Normally the stream is ahead — that is the point of it. The exception is a
 * stream that dropped before its last event: a row would then sit on a stale
 * `processing` forever, while a later server read already says `ready`. Terminal
 * is final and cannot be regressed by the worker either (see the Claim enum), so
 * a terminal rendered status outranks any observation.
 *
 * Both the row's status chip and the pipeline nested inside it reconcile through
 * here, so the label and the steps cannot disagree about the same document.
 */
export function effectiveStatus(rendered: string, observed: string | null): string {
    if (observed === null) return rendered;
    return isTerminalDocStatus(rendered) ? rendered : observed;
}

// How many rows may hold a stream open at once.
//
// This is a correctness bound, not a nicety. Each open EventSource is a
// server-side Firestore listener AND one of the ~6 connections a browser grants
// per origin over HTTP/1.1 — five live rows plus the page's own requests is a
// tab that stops loading anything. The single-document upload model means the
// cap is only ever reached when the worker is down and several uploads have
// stacked up at `uploaded`, which is exactly when a wedged page is least helpful.
export const MAX_LIVE_STREAMS = 3;

/**
 * Which of the displayed rows may watch their document's stream.
 *
 * Rows arrive in the column's display order (newest first — see selectRecent),
 * and the newest non-terminal ones are the ones actually moving. Terminal rows
 * are excluded rather than merely deprioritised, so a column of finished
 * documents never spends the budget: four `ready` rows and one `uploaded` row
 * still watch the one that matters.
 *
 * Rows left out are not lying about anything — they render the last status the
 * server sent, which remains true until something changes it.
 */
export function selectLiveDocIds(
    rows: readonly { docId: string; status: string }[],
    max: number = MAX_LIVE_STREAMS,
): Set<string> {
    const live = new Set<string>();
    for (const row of rows) {
        if (live.size >= max) break;
        if (!isTerminalDocStatus(row.status)) live.add(row.docId);
    }
    return live;
}
