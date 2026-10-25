# Presentation readability ratchet

Orders Supplier and Finance views now have expanded functions, declarations and
object properties. Long HTML templates use adjacent string-template pieces;
their concatenation preserves exactly the original markup, escaping and
expression evaluation order. No new module or lazy runtime boundary was added.

| Canonical source | Lines >500 before/after | Lines >1000 before/after | Longest before/after |
| --- | --- | --- | --- |
| Orders Suppliers view | 4 / 0 | 3 / 0 | 3022 / 343 |
| Orders Finance view | 26 / 0 | 14 / 0 | 3835 / 463 |

Local verification compared parsed program structure before/after, normalizing
only equivalent adjacent string templates and source positions/quote spelling.
All template values and embedded expressions remained equivalent. Recorded
counts are in `evidence/readability-20261015.json`. Native search, Finance,
performance and workflow tests exercise the resulting deployed views in CI.

`tools/readability-audit.mjs` and its model gate scan canonical public application
and shared JS, excluding generated copies and vendor assets. Per-file counts
above 500/1000 and longest-line ceilings can only decrease relative to the
checked-in baseline. New files have no long-line allowance. This is a count/max
ratchet, not a claim that every unchanged historical long line is readable.

Run `node tools/readability-audit.mjs` to check. `--write-baseline` is an explicit
maintenance operation requiring review of the baseline diff; CI never rewrites
it. Intentional cleanup should tighten the affected entries. Compatibility
readers, immutable migrations and generated copies remain intentional.

## User text integrity and edited-code conventions, 2026-10-25

The same canonical-source audit now checks cooked JavaScript strings and template
parts for repeated question-mark words and Unicode replacement characters. This
gate has no historical allowance. Operators, comments, regular expressions, URL
query strings and isolated placeholders are excluded. Escaped damaged text is
checked after decoding. The existing Node model discovery runs the regression
gate in CI; `node tools/readability-audit.mjs` also reports file/line locations.
This detects the reproduced corruption pattern, not every possible mistranslation.

Four unreadable notices were corrected in the two action roots and the Kupa
Credit export entrance. The fallback action notice reports incomplete execution;
it does not infer whether a local save or cloud acknowledgement succeeded.

For edited code, keep one responsibility per function, use explicit port names
and return delegated completion. Capture authority before asynchronous work and
keep runtime validation at external boundaries. Domain owners report durable-save
and publication outcomes; connectivity failures describe unavailable transport;
presentation failures describe incomplete display/action work. A generic catch
must not claim data loss, successful persistence or a cloud ACK without a receipt.
Expand edited dense branches and tighten their existing readability allowance
when cleanup removes historical long lines. Do not reformat unrelated modules.

Readability adds about 17 KB of uncompressed source in Orders with no additional
startup requests; its deterministic source ceiling records that explicit cost.
Cold/cached/offline and 1000-row render gates still decide runtime regressions.

The graph's legacy 60 KB raw module guard remains unchanged elsewhere. Orders
Finance alone has a 72 KB normalized source ceiling and a stricter 58.5 KB token
ceiling (measured 71,421 / 58,179 bytes). Token measurement excludes formatting
between tokens while preserving whitespace inside literals/templates. Both caps
must pass, so expanding indentation cannot hide new code or unbounded comments.

## Focused Bank cleanup, 2026-10-16

Three existing Kupa Bank helpers (`bankMissingSummary`, `bankChequeImageButtons`, `setBankDateMode`) were expanded without changing their complete parsed program structure. This removes three lines above 500 characters from that view (17 to 14), costs 221 normalized bytes and tightens only that file's count allowance. The view's remaining longest-line ceiling is unchanged. Source and AST hashes are recorded in `evidence/readability-bank-20261016.json`. This is targeted maintenance, with no new presentation module or runtime boundary.
