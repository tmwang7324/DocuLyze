# DocuLyze

RAG document-analysis tool: users upload documents and query them through a chat
interface backed by retrieval over embedded chunks. This glossary fixes the
ubiquitous language for the ingest and retrieval domain.

## Language

### Document lifecycle

A document record moves through a fixed set of statuses. These are domain states
with precise meanings, not free-form labels.

**pending**:
A Firestore record minted before the bytes are confirmed in Storage. No usable
document yet.

**uploaded**:
Bytes confirmed in Storage and cross-checked. The resting state before ingest,
and the recoverable resting state if enqueue fails.

**processing**:
Claimed by the ingest worker under a *lease* (see **Processing lease**). Also the
recoverable resting state if a dependency outage dead-letters the job mid-ingest.

**ready**:
Chunks for this document are in the vector store. Defined by exactly one thing:
"chunks are in the vector store, so retrieval over this document works." Nothing
reaches `ready` until the chunk write succeeds.

**failed**:
The document *itself* cannot be ingested — bad bytes, a parse failure, or no
embeddable content. The object is retained (flag-only). `failed` **never** means
a dependency was down: a Voyage or vector-store outage is infrastructure, not a
bad document, and rides the dead-letter path instead.
_Avoid_: "errored", "rejected" (reserve for the pre-sign validation gate).

**Processing lease**:
The claim on a document while a worker ingests it. Recorded as `status: processing`
+ `claimedAt`, granted by the claim transaction. A *fresh* lease means a worker is
plausibly still working (a second claimant backs off); a *stale* lease — older than a
TTL that must exceed the worst-case job runtime — means the holder crashed and may be
taken over. The lease makes "one active ingest per document" a code invariant rather
than an accident of running a single worker, so scale-out can't corrupt the vector
store. _Not_ a substitute for idempotent replay: delete-then-add still covers the
sequential crash-then-retry case.

### Retrieval

**Chunk**:
A bounded span of a document's extracted text, embedded as one vector and stored
with `{ userId, docId }` metadata. The unit of retrieval — RAG matches and cites
chunks, not whole documents.

**Tenant gateway**:
The single function pair through which *all* vector-store access flows
(`writeUserChunks` / `queryUserChunks`), each of which injects the caller's
tenant filter so no call site can read or write across users. The vector-store
analogue of the one canonical storage-path formula — "one place, can't drift."

**Embedding pin**:
The embedding model + version, fixed in config and recorded alongside every
stored chunk. Changing it is an explicit full re-embed migration, because mixing
vector dimensions/spaces silently corrupts retrieval.
