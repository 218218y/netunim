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

Representative peak resource measurement follows this stage.
Default Bank Bridge CORS remains unchanged until actual client/origin inventory
and recovery evidence justify a compatibility change. See the existing
[threat model](BRIDGE_THREAT_MODEL_20261022.md).

Two physical computers, full installed Windows/PWA upgrades, copied-backup
restores with pending work and real financial test-provider cases remain
**NOT RUN** without the isolated environment required by the
[operational protocol](OPERATIONAL_ACCEPTANCE_20261022.md). Automated/synthetic
evidence must not be relabeled as physical acceptance.
