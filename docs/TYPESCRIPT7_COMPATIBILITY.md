# TypeScript 7 compatibility assessment — 2026-10-25

This is the historical `5a5c7c2e` experiment. The expanded 365-root comparison,
individual diagnostic analysis and current decision are in
[TYPESCRIPT7_CURRENT_COMPARISON.md](TYPESCRIPT7_CURRENT_COMPARISON.md).

Decision: retain the locked TypeScript 6.0.3 compiler and Compiler API. Do not add
a second production/compiler dependency yet. A native compiler speedup is real
in this experiment, but diagnostic equivalence fails on this project's baseline.

## Reproducible scope

TypeScript 7.0.2 was installed with an exact version under the ignored
`.work/ts-hardening/ts7` directory. An isolated source snapshot was reconstructed
from Git commit `5a5c7c2e`, using the TS 6 compiler program's actual source files,
the original `tsconfig.contracts.json`, and the relevant ESM package manifests.
The product lockfile, vendor inventory, typecheck command and test compiler were
not changed. Both compilers checked the same original configuration and files.

The measured commands were Node 24.21.0 running the installed TS 6 `bin/tsc`, and
the TS 7 Windows x64 native `lib/tsc.exe`, with `--project tsconfig.contracts.json
--pretty false`. The TS 7 JS launcher's overhead is excluded. Each compiler ran
three times, interleaved, on the same local Windows machine. The first sample
includes cold startup/cache effects. These are local samples, not CI estimates.

| Compiler | Wall seconds, three runs | Median seconds | Median peak working set |
| --- | --- | ---: | ---: |
| 6.0.3 | 15.738, 8.662, 8.433 | 8.662 | 420.11 MiB |
| 7.0.2 | 1.458, 0.746, 0.661 | 0.746 | 230.49 MiB |

Memory uses the Windows process `PeakWorkingSetSize` counter sampled every 20 ms.
It measures the compiler process, not system memory or a parallel CI workload.
The native CLI is about 11.6 times faster by these medians. The total CI speedup
was not measured; the existing in-memory Compiler API mutation suites still need
TS 6, so this result does not justify a comparable overall CI speedup claim.

## Diagnostics and negative cases

TS 6 returned zero diagnostics in all three baseline runs. TS 7 returned the same
11 diagnostics in each run: five JSDoc/type-import symbol-resolution failures,
four implicit-any diagnostics, one union-property diagnostic and one unused
`@ts-expect-error` in the calendar session consumer. The latter means at least
one existing negative consumer is no longer rejected as expected. Its underlying
inference/resolution cause has not been isolated; it must not be suppressed.

Two independent source mutations were also tested in the isolated snapshot:

- A checkpoint writer returns a string sequence.
- The actual IndexedDB completion callback resolves a string instead of its
  prepared generic receipt.

Each compiler added one relevant diagnostic for each mutation: TS 6 went from
0 to 1, TS 7 from 11 to 12. This verifies these two mutations only; it does not
establish equivalence of all existing negative and mutation tests. Exact samples,
diagnostic locations/codes and mutation diagnostics are in
[`typescript7-comparison.json`](typescript7-comparison.json).

## Compiler API and offline gate

The installed 7.0.2 package has a native executable launcher but no
`lib/typescript.js` with the legacy `createCompilerHost`/`createProgram` API.
The existing mutation harness imports that exact API. The offline installer also
explicitly requires `lib/typescript.js`, `lib/tsc.js` and `lib/_tsc.js`; TS 7 is
not a drop-in package for this contract.

The registry lists 20 platform-specific optional packages for 7.0.2. Linux x64
and Windows x64 native packages alone declare 27,945,990 and 28,365,027 unpacked
bytes respectively, before the shared package and any additional architecture.
A dual installation would retain TS 6 as well. No native packages were added to
the vendor bundle. Linux offline installation and Windows CI equivalence for TS 7
were not claimed or tested: the diagnostic prerequisite already fails.

Revisit a dual CLI/API setup only after resolving the 11 diagnostics without
weakening consumers and demonstrating a useful total CI benefit. A full API
migration additionally requires a stable supported API and equivalent mutation
coverage. The current existing TS 6 offline and CI checks remain mandatory.

Microsoft's [7.0 announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)
confirms the stable native release; the [7.1 Beta announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-1-beta/)
describes the new API. The stable registry package tested here is
[TypeScript 7.0.2](https://www.npmjs.com/package/typescript/v/7.0.2).
