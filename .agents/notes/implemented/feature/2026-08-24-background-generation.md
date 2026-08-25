# Agent Note: background generation execution

Status: implemented

English | [中文](2026-08-24-background-generation.md)

## Problem

Deployed behind a reverse proxy (nginx/宝塔 defaults: 60s), clicking
生成章节草稿 died with HTTP 504: the route synchronously awaited a full
chapter LLM call that legitimately takes longer than the proxy budget.
Local dev (direct localhost) never exposed this. 立即处理队列 had the same
flaw for large batches.

## Decision

Move interactive generation onto the existing V5 job queue with in-process
background execution:

- **Job-level overrides** — `generation_jobs` gains `instructions`,
  `min_chars`, `submit_for_review`, `llm_review` (NULL = fall back to the
  book's serial config; additive idempotent migration via PRAGMA check, so
  existing DBs upgrade in place). `enqueueGenerationJobs(bookId, count,
  opts)` stores them per batch. The workbench keeps every toggle it had —
  they now travel through the queue instead of an HTTP wait.
- **Executor semantics extended** — final status mapping:
  `!created` → rejected; `submitForReview=false` → draft (new);
  LLM holdNote → held (new); submit+autoPublish → published; else submitted.
- **`POST /serial/run` mode=background** — kicks processing without
  awaiting and returns `{started, alreadyRunning, pending}` immediately.
  The worker promise lives on `globalThis` so HMR duplicates and double
  clicks collapse into one runner; sync mode stays available for scripts.
- **Workbench UX** — generate button enqueues one job with the toggles,
  kicks a background run, then polls `/serial/jobs?bookId=` every 3s (10min
  cap), streaming rows into the jobs table and rendering the outcome
  (落稿/待审核/暂扣/拒绝/失败) when the job settles. processQueue polls the
  same way until its book has no active jobs.

Verification: test:ai-serial +5 assertions (draft outcome, per-job minChars
override rejecting while sibling succeeds, instructions stored & executed),
test:ai-serial-api background-mode case asserts sub-2s response then worker
completion; CDP audit 4/4 — click returns instantly (button flips to
生成中…), mock chapter lands ~3s later with 待审核 badge. Full typecheck +
build green.

## Alternatives considered

**Raise proxy timeout / document nginx tuning.** Necessary operationally but
not a code fix; any shared host or serverless edge would still cut us off.
Background mode removes the dependency entirely (responses are now instant).

**Streaming (SSE) completion.** Keeps the sync shape but complicates the
provider abstraction and still dies on proxies that buffer SSE; queueing was
already built in V5, so we reused it.

**Serverless-safe worker (separate queue process).** Fire-and-forget after
response requires a long-lived Node process; fine for self-hosted
`next start`, would need a real worker on Vercel-style platforms. Documented
as the known boundary.

## Consequences

Gained: generation is immune to proxy timeouts everywhere; workbench and
serialization share one execution path; failures surface as job rows instead
of HTTP errors. Costs: result latency is quantized to the 3s poll; the
background worker dies if the Node process restarts mid-run — those jobs
stay `running` forever unless a future sweep re-queues stale runners (known
gap, acceptable at this scale); UI polling stops after 10 minutes, after
which the table itself is the source of truth.
