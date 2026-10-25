# TypeScript comparison after the critical implementation rounds

Decision: keep TypeScript 6.0.3 as the sole required compiler/API and offline
dependency. The current CLI can be made compatible with TS 7.0.2 without
weakening contracts, but the mutation harness and offline package layout are
not equivalent. A permanent second compiler would add a check while retaining
the TS 6 API workload; no total CI benefit has been demonstrated.

## Corpus and diagnostic isolation

Both Windows x64 experiments snapshot the actual TS 6 program at `5600bcb8`:
365 roots and 510 non-library files, including package manifests. No compiler
package, lockfile, vendor archive or required command changes. The checked-in
[raw report](typescript7-current-comparison.json) records corpus SHA-256, source
revision, working-tree differences, both samples and each mutation's additional
diagnostics. Machine-specific absolute source paths are redacted.

The unmodified corpus has zero TS 6 diagnostics and these eleven TS 7 diagnostics:

| Location | Cause | Semantically valid repair |
| --- | --- | --- |
| Calendar connection, TS2694 | ReturnType references a function value as a type | Add `typeof` to its JSDoc import |
| Calendar session auth, TS2694 | Same function-value import | Add `typeof` |
| Calendar browser effects, TS2694 | Same function-value import | Add `typeof` |
| Calendar session error callback, TS7006 | Contextual inference lost through the invalid auth type | Restored by the auth import repair |
| Calendar presentation range, TS2694 | Function-value import | Add `typeof` |
| Morning debt lifetime, TS2694 | Function-value import | Add `typeof` |
| Calendar negative consumer, TS2578 | The missing auth contract stopped rejecting an invalid argument | Restored by the import repair; the expect-error remains |
| Publication negative consumer, TS2339 | TS 7 does not retain this aliased discriminant narrowing | Inspect `publication.reason` directly; the unknown-error negative test remains |
| Three Morning lifetime callback parameters, TS7006 | Contextual inference lost through the invalid lifetime type | All restored by its import repair |

Five `typeof` additions and the direct discriminant check fix every diagnostic
under both compilers. These are explicit references to function values and the
same union condition, with no assertions, broader types, removed negative tests
or runtime behavior changes. Both repaired baseline samples report zero errors.
33 focused Calendar/Morning behavior/policy tests, readability/source gates,
the authoritative compiler and ESLint pass.

## Mutation evidence and measurements

Both compilers reject all three additional actual-body mutations, independently
of their baseline diagnostics: fabricated immediate completion of an asynchronous
local commit, converting a missing cashflow balance into zero, and treating an
unknown RPC row as an ACK. Additional diagnostic counts are 1, 1 and 2 for each
compiler. This covers three critical boundaries; it is not full mutation parity.

| Repaired corpus, two Windows samples | TS 6.0.3 | TS 7.0.2 |
| --- | --- | --- |
| CLI seconds | 7.244 / 8.058 | 1.857 / 0.904 |
| Median seconds | 7.651 | 1.381 |
| Baseline diagnostics | 0 | 0 |
| Tested mutations rejected | 3/3 | 3/3 |

The complete repaired comparison process (four baseline and six mutated CLI
executions across both compilers) took 39.700 seconds. The earlier unmodified
process took 60.249 seconds under different machine load; these are experiment
wall times, not before/after CI savings. Two samples show material CLI speed and
variation, not a stable project-wide performance estimate. Full CI/Windows/Linux
mutation-API equivalence was not measured and is not claimed.

## API and offline decision

The installed 7.0.2 package root exposes version information rather than legacy
`createProgram`. It provides `unstable/*` API exports, and lacks
`lib/typescript.js` and `lib/_tsc.js`; `lib/tsc.js` is a native launcher. The
existing mutation fixture imports the legacy Compiler API, and the offline
installer explicitly verifies all three legacy files. A CLI-only substitution
does not preserve either acceptance contract. No native platform package was
added to the project's offline inventory.

Microsoft's [7.0 announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)
describes the JS/JSDoc differences and the API limitation. The
[7.1 Beta announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-1-beta/)
describes new `typescript/sync` and `typescript/async` entrypoints. Beta API work
does not justify replacing this project's working mandatory API. Revisit with
an appropriate stable API, the full mutation set, offline Windows/Linux native
installation and measured complete verification time.

To rerun without installing into the project, supply an already isolated pinned
candidate and a fresh output directory inside `.work`:

```powershell
node tools/compare-typescript-compilers.mjs --candidate-package .work/ts-hardening/ts7/node_modules/typescript --output .work/typescript-fresh-comparison
```

The script copies the program before mutating it, restores each snapshot file
in a finally block, refuses to reuse a snapshot and never edits required compiler
configuration. Snapshot files and machine-specific raw output remain ignored.
