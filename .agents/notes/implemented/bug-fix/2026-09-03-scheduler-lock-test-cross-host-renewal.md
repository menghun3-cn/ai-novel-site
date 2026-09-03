# Agent Note: scheduler-lock test must match the cross-host renewal semantics

Status: implemented

English | [中文](2026-09-03-scheduler-lock-test-cross-host-renewal.zh.md)

## Problem

`scripts/verify-scheduler-lock.ts` step 4 simulated a crashed holder by
writing `{ pid: 999999999, hostname: 'ghost', at: <now> }` and asserting the
lock is taken over. Since `29b21a3` (根治 scheduler.lock 卡死导致定时停摆)
changed the holder-liveness rules — same-host holders are identified by
`/proc/<pid>/cmdline`; **cross-host holders are judged by renewal time
(`at` within `STALE_GRACE_MS`)** — that fixture is now a *live* cross-host
holder: `at` is fresh, so `acquireSchedulerLock()` correctly returns `null`
and the test crashed on `lock3!.release()` (`Cannot read properties of null`).

The test predates the cross-host renewal rule and was never updated with it,
so `npm run test:scheduler-lock` has been failing on develop.

## Decision

Align the test with the shipped liveness semantics, splitting the old single
"dead pid" case into the three distinct rules the implementation actually
enforces:

1. **Same-host dead pid** (`hostname` = current host, nonexistent pid) →
   taken over (cmdline check fails, `isPidAlive` false).
2. **Cross-host stale** (different host, `at` older than `STALE_GRACE_MS`) →
   taken over.
3. **Cross-host fresh** (different host, `at` within the grace period) →
   treated as a live holder; `acquireSchedulerLock()` returns `null` and the
   lock file is left in place (cleaned up manually in the test).

The damaged-lock takeover and "release must not delete a foreign lock" cases
are unchanged. The file-header comment now enumerates all covered rules.

## Alternatives considered

**Change the implementation to treat every cross-host lock as stale.**
Rejected: `29b21a3` deliberately introduced the renewal-based rule so a
rebuilt container (new hostname, same shared lock file) does not instantly
take over a lock its still-running sibling is holding; reverting that would
reintroduce the dual-scheduler race it fixed.

**Delete the "cross-host fresh" assertion and only fix the fixture.**
Rejected: that is the exact case the old fixture hit by accident; asserting
it explicitly is what makes the test document the rule instead of tripping
over it.

## Consequences

- `npm run test:scheduler-lock` is green again (13 assertions on POSIX, 12 +
  one platform skip on Windows).
- The test now covers same-host stale, cross-host stale, and cross-host live
  holders — the full decision surface of `isLiveHolder` — so a future change
  to the liveness rules fails loudly here.
- No production code changed; `scheduler-lock.ts` behavior is untouched.
