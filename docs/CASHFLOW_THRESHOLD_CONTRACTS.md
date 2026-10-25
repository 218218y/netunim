# Cashflow threshold and warning contracts

The actual threshold/settings and dated-warning implementations are now strict
roots. Account roles reuse the existing credit-calculation contract. An
unavailable projection has `projected:null`, `active:false` and an explicit
`unavailable` reason; it cannot be certified as a real zero balance or active
breach. Settings retain nullable minimums, and absent breach dates retain a
nullable day count. Retained movement money/date fields stay unknown until the
existing runtime conversion runs; a warning is neither bank evidence nor an ACK.

This is a focused financial dependency stage. The 612-line reconciliation and
settlement engine in `kupa-cashflow.js` is still outside strict roots. Its amount,
coverage and settlement-proof contracts require their own review; this stage
does not certify that whole engine or change its calculations.

All 44 existing cashflow tests pass, including missing balance, zero/signed
money, horizon/year changes, warning windows and historical bank data. A local
1,656-case before/after comparison against `3f8ef6eb` matched outputs/errors.
Strict compilation passes. One local actual-body mutation proves that replacing
the unavailable null projection with zero fails the discriminated contract;
the active-flag and breach-day mutations remain mandatory in CI.

The configuration now has 334 roots (209 product modules and 125 fixtures).
Measured eager source grows by 1,249 bytes per app for annotations. Source
ceilings increase by 2,000 to 1,861,000/2,485,000; module/time ceilings and
runtime financial behavior remain unchanged.
