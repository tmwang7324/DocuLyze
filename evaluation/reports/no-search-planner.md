# No-search Turns and planner

| Setting | Value |
|---|---|
| needs_search_model | `gpt-5.4-mini` |
| planner_model | `gpt-5.4` |
| plan_reasoning_effort | `none` |
| chat_model | `gpt-5-mini` |
| chat_reasoning_effort | `low` |
| judge_model | `gpt-4.1-mini-2025-04-14` |
| today | `2026-11-06` |

## Needs-search gate

- Search cases searched: **13/13**. Wrongly skipped (dangerous: an answer with no sources): none.
- Skip cases skipped: **10/10**. Wrongly searched (cheap: an unneeded search): none.
- Planning errors: none. Degraded plans: none.

## Planner (search cases the gate let through)

| Case | Result | Failures |
|---|---|---|
| `search-simpler` | pass |  |
| `search-example` | pass |  |
| `search-deletion` | pass |  |
| `search-elaborate` | pass |  |
| `search-second` | pass |  |
| `search-new-topic` | pass |  |
| `search-compare` | pass |  |
| `search-this-year` | pass |  |
| `search-b-tree` | pass |  |
| `search-summarize` | pass |  |
| `search-extract-min` | pass |  |
| `search-no-history` | pass |  |
| `search-compound` | pass |  |

## No-search answers (production no-search prompt, every skip case)

- Judged to do what was asked from the conversation alone: **10/10** (errors: 0).
- Judged refusals: none.
- Deterministic checks failed: none.

| Case | Checks | Fulfils | Refusal | Error |
|---|---|---|---|---|
| `skip-thanks` | - | True | False |  |
| `skip-thank-you` | - | True | False |  |
| `skip-greeting` | - | True | False |  |
| `skip-ack` | - | True | False |  |
| `skip-table` | table=ok | True | False |  |
| `skip-shorter` | shorter=ok | True | False |  |
| `skip-translate` | - | True | False |  |
| `skip-bullets` | bullets=ok | True | False |  |
| `skip-recall` | - | True | False |  |
| `skip-thanks-no-history` | - | True | False |  |
