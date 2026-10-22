# Focused quality completion, 2026-10-22

Base: `2289bdbaf5abe246b50366ec558cf1e35e9214cd` (PR 281), Document Bridge v43. Source findings are verified
against this checkout; the external archive review is a research input.

## Financial presentation

Reproduced missing normalized transaction amounts becoming zero in both bank
alert kinds and Morning selection labels. Both bank tables also collapsed
unknown and genuine zero into the same empty debit/credit cells. They now use
the existing `readBankMoney` contract: unknown amounts say “סכום לא ידוע”, zero
remains a known displayed amount, and signed amounts retain their direction.
Unknown amounts span both direction columns without inventing a debit or credit.
Morning eligibility is unchanged; absent/nonpositive amounts cannot be selected
for receipt creation. Selected historical labels still explain unknown amounts.

Caption and post-transaction balance reads use the same contract defensively.
Normal feed normalization already rejects missing primary balances; this is
additional presentation protection, not evidence of corrupt stored balances.
No historical values, archive metadata, acknowledgement identities, storage,
synchronization or provider writes are changed.

`tests/bank_money_display.test.mjs` exercises normalization → alert/selection
model → actual HTML and public view methods, unknown/coercible/invalid amounts,
true and numeric-string zero, signed values, navigation and dismissal. Existing
bank/Morning/integrity/date tests remain required, together with the full CI gate.

## Remaining investigations and acceptance

### Search parity: reproduced and corrected

The opt-in isolated Everything probe now has a 16-document Unicode corpus and
48 combinations of six queries, four modes and both word policies. It compares
native candidates, canonical results and actual coordinator publication, then
checks nonzero result offsets, ordering, lookahead and an excluding file filter.
Everything 1.5.0.1424 / ES 1.1.0.38 reproduced 17 mismatches: underscores were
treated as word characters, combining marks as boundaries, and default native
matching ignored Hebrew marks inside words. These are real false positives and
false negatives, not an assumed API difference.

The [before observation](evidence/search-parity-before-20261022.json) runs the
committed v43 query builder from `2768d51f`; the
[after observation](evidence/search-parity-after-20261022.json) records the v44
working query builder. Both identify exact module/corpus/binary hashes and the
dirty research harness. The index contains only owned synthetic files, every
indexed path is checked before reads, and each owned native process exits.
After correction, all 48 actual coordinator result sets equal the canonical sets.

Literal content queries explicitly enable the documented
[`diacritics:` modifier](https://www.voidtools.com/support/everything/search_modifiers/).
Partial phrase/all/any searches remain native and do not fetch full content.
Whole-word queries retrieve literal candidates without native word boundaries,
then use the existing canonical verifier, bounded batching, deadline and paging.
Proximity retains that same verifier. Phone and raw Everything modes retain their
existing policies. CI regressions cover all whole-word corpus combinations and
assert that ordinary partial searches still avoid extraction. This is scoped
plain-text evidence, not a claim about every installed PDF/Office text extractor.

Bridge/client/installer v44 requires the corrected semantics. Version checks,
generated assets, Service Workers and release headers must remain synchronized.

### Peak resource measurement and bounded verification

The Windows driver `tools/measure-document-search-resources.py` measures the OS
`PeakWorkingSetSize` counter of each fresh Node child, including synchronous
peaks that a JS interval cannot sample. Child CPU microseconds, before/after
memory, source/driver hashes, Node version and CPU identity are preserved. Two
fresh children per size/scenario ran at 0.5, 2, 4 and 8 MiB, with a 512 MiB V8
heap ceiling. Only generated repeated text was used. The
[before report](evidence/matcher-resource-before-20261022.json) uses the committed
matcher copied from `1462ac81`; the
[after report](evidence/matcher-resource-after-20261022.json) identifies the changed
canonical source by hash, not a claim of a clean committed run.

| 8 MiB Hebrew scenario | Before peak / median compute | After peak / median compute |
| --- | --- | --- |
| Missing final term | 411.4 MiB / 414.5 ms | 64.7 MiB / 7.7 ms |
| First valid range | 411.6 MiB / 407.6 ms | 100.4 MiB / 317.9 ms |
| 5,000-range display cap | 411.7 MiB / 406.2 ms | 100.2 MiB / 325.2 ms |

This justified a small representation change within the same canonical matcher:
UTF-16 start/end typed arrays replace retained per-word strings/objects; two
reused DP arrays and a descending successor cursor preserve the same rightmost
greedy policy. Missing required literals exit before indexing. Exhaustive tiny
legacy-regex comparisons, Unicode highlights, DOM/Bridge/worker parity and a fresh
96 MiB V8-heap regression preserve matching and the display cap. No streaming
engine, cache, output-ceiling increase or alternative matcher was introduced.

The [dense ASCII check](evidence/matcher-resource-dense-20261022.json) adds the
shortest practical repeated words: 8 MiB first-match/display cases peak at about
135.3 MiB and median compute stays below 588 ms. A provisional engineering
guardrail is 192 MiB total peak working set and 2 seconds compute per fresh
8 MiB synthetic matcher child. All measured samples pass. This is explicitly
not a total Bridge-process cap, a concurrency cap, a p95 estimate from two samples,
or certification of a minimum supported physical computer. That target-machine
acceptance remains NOT RUN. Each input/JSON batch remains under the existing
16 MiB external-output ceiling, whose adaptive reduction is unchanged.

A new regression reproduced publication winning over an event-loop cancellation
queued after extraction. The coordinator now yields after each document's
canonical verification and rechecks cancellation before retaining the result.
It also accounts for decode/verification time in its overall deadline, reporting
verified progress as explicitly partial when that deadline is exceeded. Real
ephemeral HTTP tests cover concurrent content verification plus health, first
timeout with no published IDs, a successful fresh search after failure, and
disconnect cancellation in partial, proximity, whole-word and recent modes.
The synchronous matcher itself is not interrupted mid-document; the next event
turn prevents subsequent work/publication after a pending cancellation.

Bridge/client/installer v45 requires this resource and cancellation correction.
The [isolated native replacement](evidence/document-bridge-upgrade-43-45-20261022.json)
exercises pinned v43 → current v45, rejects the old listener, preserves token and
configuration and shuts down its owned processes. Its report includes module
hashes and dirty-source provenance. It does not execute the global installer,
Startup/task registration, working service, provider login or PWA upgrade.

### Bank origin decision and release limits

Source inventory confirms `bargig-orders.pages.dev`, `bargig-kupa.pages.dev`,
their configured preview families, `orders.bargig-furniture.com`,
`kupa.bargig-furniture.com` and local development/native clients. A PWA has its
application's origin. This inventory comes from code/deployment scripts and is
not a complete census of existing custom-domain installations. Their allowed
origins, browser private-network permissions, installed upgrade/re-pairing and
rollback compatibility are still unverified. The existing Bearer gate and CORS
default therefore retain the documented compatibility decision below.

`sync-assets --check`, generated worker equality, strict client/runtime version
checks, release headers and both Service Worker manifests guard mixed bundles.
Full branch CI (including PostgreSQL, checkJs/ESLint, real browsers and Windows)
is mandatory at each exact candidate before merge. Final PR/run records identify
the tested source; an identical merged Git tree does not need a duplicate gate.
These checks do not claim a live rollout or physical/provider acceptance.
Default Bank Bridge CORS remains unchanged until actual client/origin inventory
and recovery evidence justify a compatibility change. See the existing
[threat model](BRIDGE_THREAT_MODEL_20261022.md).

Two physical computers, full installed Windows/PWA upgrades, copied-backup
restores with pending work and real financial test-provider cases remain
**NOT RUN** without the isolated environment required by the
[operational protocol](OPERATIONAL_ACCEPTANCE_20261022.md). Automated/synthetic
evidence must not be relabeled as physical acceptance.
