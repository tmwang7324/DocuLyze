import { describe, it, expect } from "vitest";
import {
    pipelineView,
    selectLiveDocIds,
    effectiveStatus,
    PIPELINE_STEPS,
    MAX_LIVE_STREAMS,
    type PipelineInput,
} from "@/_lib/pipeline_view";

// Seam: the pipeline view — a document's status (plus what finalize said about
// the enqueue) in, the step list, notice and "should this row hold a stream
// open" decision out. (issue #26)
//
// Extracted from components/pipeline_progress.tsx when the pipeline moved into
// every row of the upload screen's recent column. Previously one screen showed
// one pipeline and it could be verified by looking at it; now up to five render
// at once, each seeded from a different status, and the two decisions that
// matter are invisible:
//
//   - the step states. A document that FAILED must never render a green check on
//     the step it died on, and a status this build has never heard of must never
//     render as finished. Both are one-line lies in a list that looks fine.
//   - `watch`. A view that keeps an EventSource open against a finished pipeline
//     holds a server-side Firestore listener forever, and a browser only grants
//     ~6 connections per origin — five leaked streams wedge the whole page.
//
// Pure module: no server code, no emulator, no credentials — same as the archive
// projection's suite.

function input(over: Partial<PipelineInput> = {}): PipelineInput {
    return { status: "uploaded", enqueue: null, patienceExpired: false, ...over };
}

const stateOf = (view: ReturnType<typeof pipelineView>, label: string) =>
    view.steps.find((step) => step.label === label)?.state;

describe("pipelineView", () => {
    describe("steps", () => {
        // The record's vocabulary -> the step the user is looking at. "Uploading"
        // is deliberately absent: by the time a record exists the bytes have
        // landed, and the byte progress belongs to the form that owns the PUT.
        it("puts the active step on Queued while the record is uploaded", () => {
            const view = pipelineView(input({ status: "uploaded" }));
            expect(stateOf(view, "Queued")).toBe("active");
            expect(stateOf(view, "Parsing")).toBe("todo");
        });

        it("advances to Parsing once the worker claims the document", () => {
            const view = pipelineView(input({ status: "processing" }));
            expect(stateOf(view, "Queued")).toBe("done");
            expect(stateOf(view, "Parsing")).toBe("active");
        });

        it("completes every step at ready", () => {
            const view = pipelineView(input({ status: "ready" }));
            expect(view.steps.every((step) => step.state === "done")).toBe(true);
            expect(view.ready).toBe(true);
        });

        // The regression this file exists for: `failed` must mark the step it
        // died on, never complete it. A green Parsing under a failed document is
        // a normal-looking lie.
        it("marks the step a failed document died on, and never completes it", () => {
            const view = pipelineView(input({ status: "failed" }));
            expect(stateOf(view, "Parsing")).toBe("failed");
            expect(view.steps.some((step) => step.state === "done" && step.label === "Parsing")).toBe(
                false,
            );
            expect(view.parseFailed).toBe(true);
            expect(view.ready).toBe(false);
        });

        // Additive degradation, the rule the archive projection follows too: the
        // pipeline gains states faster than the UI does, and the one thing an
        // unknown state must never do is claim the document is finished.
        it("renders an unknown status as still working, never as done", () => {
            const view = pipelineView(input({ status: "embedding" }));
            expect(view.genericInProgress).toBe(true);
            expect(view.ready).toBe(false);
            expect(view.parseFailed).toBe(false);
            expect(view.steps.every((step) => step.state === "done")).toBe(true);
        });

        // A halted view is not being watched by anything — freezing the animation
        // is the honest rendering, and an "active" step animates.
        it("shows no active step once the view is halted", () => {
            for (const halted of [
                input({ patienceExpired: true }),
                input({ enqueue: "failed" }),
            ]) {
                const view = pipelineView(halted);
                expect(view.halted).toBe(true);
                expect(view.steps.some((step) => step.state === "active")).toBe(false);
            }
        });
    });

    describe("watch", () => {
        it("watches a document still moving through the pipeline", () => {
            expect(pipelineView(input({ status: "uploaded" })).watch).toBe(true);
            expect(pipelineView(input({ status: "processing" })).watch).toBe(true);
            expect(pipelineView(input({ status: "embedding" })).watch).toBe(true);
        });

        // Terminal means the server ends the stream. Re-opening one against a
        // finished pipeline just makes EventSource reconnect in a loop.
        it("never watches a terminal document", () => {
            expect(pipelineView(input({ status: "ready" })).watch).toBe(false);
            expect(pipelineView(input({ status: "failed" })).watch).toBe(false);
        });

        // "failed" enqueue is definitely-not-queued: nothing will transition, so
        // there is nothing to watch. "unknown" MAY have landed, so it does watch
        // and self-heals.
        it("does not watch a definite enqueue failure, but does watch an unknown one", () => {
            expect(pipelineView(input({ enqueue: "failed" })).watch).toBe(false);
            expect(pipelineView(input({ enqueue: "unknown" })).watch).toBe(true);
        });

        it("stops watching once patience has expired", () => {
            expect(pipelineView(input({ patienceExpired: true })).watch).toBe(false);
        });
    });

    describe("notice", () => {
        it("says nothing about an ordinary in-flight document", () => {
            expect(pipelineView(input({ status: "processing" })).notice).toBeNull();
        });

        it("offers reassurance, not failure, for a definite enqueue failure", () => {
            expect(pipelineView(input({ enqueue: "failed" })).notice).toBe("enqueue-failed");
        });

        it("warns about an unconfirmed enqueue only while the record has not moved", () => {
            expect(pipelineView(input({ enqueue: "unknown", status: "uploaded" })).notice).toBe(
                "enqueue-unknown",
            );
            // The self-heal has to heal the wording, not just the steps: a
            // transition past Queued proves the envelope landed.
            expect(pipelineView(input({ enqueue: "unknown", status: "processing" })).notice).toBeNull();
        });

        it("converts silence into reassurance when patience expires", () => {
            expect(pipelineView(input({ patienceExpired: true })).notice).toBe("patience");
        });

        // "Your document is ready" announces an arrival. A column of settled
        // documents each repeating it announces nothing — and every one of those
        // rows already carries a ✓ Ready step. `enqueue` is non-null for exactly
        // the row this client just uploaded, which is the arrival.
        it("announces readiness only for the document this client just uploaded", () => {
            expect(pipelineView(input({ status: "ready", enqueue: "queued" })).notice).toBe("ready");
            expect(pipelineView(input({ status: "ready", enqueue: null })).notice).toBeNull();
        });

        // A failure is a standing condition with something to do about it, not an
        // arrival — it is stated on whatever row it happened to.
        it("states a failure on any row, however old", () => {
            expect(pipelineView(input({ status: "failed", enqueue: null })).notice).toBe(
                "parse-failed",
            );
        });

        // Precedence: the record's own terminal status is the only thing either
        // end actually observed. A stale enqueue guess must not contradict it —
        // "processing will be retried later" beside a finished document, or a
        // patience notice on a document that already failed, are both wrong.
        it("lets the record's terminal truth win over an enqueue guess", () => {
            expect(pipelineView(input({ status: "ready", enqueue: "failed" })).notice).toBe("ready");
            expect(
                pipelineView(input({ status: "failed", enqueue: "unknown", patienceExpired: true }))
                    .notice,
            ).toBe("parse-failed");
            expect(
                pipelineView(input({ status: "ready", enqueue: "queued", patienceExpired: true }))
                    .notice,
            ).toBe("ready");
            // ...and a document that arrived while nobody was watching says
            // nothing rather than falling through to a patience notice about a
            // document that is plainly finished.
            expect(pipelineView(input({ status: "ready", patienceExpired: true })).notice).toBeNull();
        });
    });
});

describe("selectLiveDocIds", () => {
    const row = (docId: string, status: string) => ({ docId, status });

    it("lets a non-terminal row hold a stream open", () => {
        const live = selectLiveDocIds([row("a", "uploaded"), row("b", "processing")]);
        expect(live).toEqual(new Set(["a", "b"]));
    });

    it("excludes terminal rows — there is nothing left to observe", () => {
        const live = selectLiveDocIds([row("a", "ready"), row("b", "failed"), row("c", "uploaded")]);
        expect(live).toEqual(new Set(["c"]));
    });

    // A browser grants ~6 concurrent connections per origin on HTTP/1.1. Five
    // SSE streams plus the page's own requests is a wedged tab, so the cap is a
    // correctness bound rather than a nicety. Rows arrive newest-first, and the
    // newest are the ones actually moving.
    it("caps concurrent streams, keeping the newest rows live", () => {
        const rows = ["a", "b", "c", "d", "e"].map((id) => row(id, "uploaded"));
        const live = selectLiveDocIds(rows);
        expect(live.size).toBe(MAX_LIVE_STREAMS);
        expect([...live]).toEqual(["a", "b", "c"].slice(0, MAX_LIVE_STREAMS));
    });

    // Terminal rows must not consume budget: a column of four finished documents
    // and one queued one should still watch the queued one.
    it("does not spend the cap on terminal rows", () => {
        const rows = [
            row("a", "ready"),
            row("b", "ready"),
            row("c", "ready"),
            row("d", "ready"),
            row("e", "uploaded"),
        ];
        expect(selectLiveDocIds(rows)).toEqual(new Set(["e"]));
    });
});

describe("effectiveStatus", () => {
    it("falls back to what the server rendered until a stream has spoken", () => {
        expect(effectiveStatus("uploaded", null)).toBe("uploaded");
    });

    it("prefers the stream once it has — that is the point of watching", () => {
        expect(effectiveStatus("uploaded", "processing")).toBe("processing");
        expect(effectiveStatus("uploaded", "ready")).toBe("ready");
    });

    // The regression: a stream that drops before its last event leaves a row
    // sitting on `processing` forever, even after a server read has already seen
    // the document finish. Terminal is final at both ends — the worker can't
    // regress it either — so the rendered status wins.
    it("lets a terminal server read override a stale observation", () => {
        expect(effectiveStatus("ready", "processing")).toBe("ready");
        expect(effectiveStatus("failed", "uploaded")).toBe("failed");
    });
});

describe("PIPELINE_STEPS", () => {
    // The step list is the archive's vocabulary minus the terminal states, in
    // order. If a step is added here the status map has to move with it.
    it("is the record's journey after the bytes have landed", () => {
        expect(PIPELINE_STEPS).toEqual(["Queued", "Parsing"]);
    });
});
