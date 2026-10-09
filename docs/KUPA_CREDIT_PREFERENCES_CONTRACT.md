# Kupa Credit computer preferences

## Proven failures

At `af1b7cbc84f56039d27fa843732e5198b41a9ffa`, a `SecurityError` from
`localStorage.getItem` escaped `creditSyncUiState`, preventing Credit rendering.
A quota-shaped write failure after `resetCreditProfiles` interrupted reset before
the mandatory Finance update: the Bridge reset ran once, the Finance commit zero
times. `credit_preferences_failure.test.mjs` failed on both sequences before the
implementation changed. These are display/partial-operation failures, not proof
of lost journal data.

The native `--baseline` drill also reproduced the escaping controlled
`SecurityError` with the prior controller in an otherwise current disposable
Kupa runtime, after actual Main/Shared ownership transfer and IDB commits.

## Ownership and results

`platform/credit-preferences.js` owns synchronous browser access to the existing
computer-local enable, mode and last-attempt keys. The composition supplies this
explicit port to the Credit controller. Construction performs no storage access;
the domain has no direct `localStorage` access. These settings are not account
data, credentials, an offline Finance outbox or a Main/Shared journal.

Each read/write returns a discriminated success or a classified failure:
`CREDIT_PREFERENCES_UNAVAILABLE`, `CREDIT_PREFERENCES_QUOTA` or
`CREDIT_PREFERENCES_INVALID`. Raw exception text and stored values are not
included in diagnostics. An invalid persisted attempt timestamp is retained and
reported, never silently deleted. Missing keys preserve historical defaults;
legacy mode aliases remain normalized by the existing domain policy.

The controller pauses automation on any observed preference failure and exposes
an independent warning/code in the Credit headline and settings diagnostics.
The effective checkbox is off. Preference recovery, login/start and polling wake
do not clear this suspension. A successful explicit enable after a complete
read clears it. A new background failure repaints the mounted Credit status once;
repeated reads do not create a render loop. A failed enable/disable/mode action returns false and displays
the warning; failed mode writes leave the previous saved selection visible.
Disable is attempted even if reads are blocked.

Before automatic provider entry, the existing last-attempt timestamp must be
saved successfully. Failure returns false before lease/provider acquisition.
The existing 24-hour cooldown, provider fallback and retry policy are unchanged.
Manual refresh remains available under the existing operation/lease guards.
An already-confirmed Finance write drains its publication/follow-up even when
preferences later become unavailable; a preference warning does not negate it.

## Reset and partial persistence

After a confirmed Bridge reset and a current operation scope, automation is
stopped. The adapter attempts disable first, mode reset second, then removes the
attempt marker. `localStorage` has no multi-key transaction: partial completion
is reported as failure. It cannot block the required scoped Finance reset or its
confirmed publication. Finance failure still preserves the last confirmed data;
preference success cannot turn it into financial success.
A complete explicit preference reset clears the old preference warning and
keeps automation disabled.

An unsuccessful persistent disable only guarantees suspension in this runtime.
The warning explicitly says it may not survive reopening. No durable fallback
setting, artificial ACK or cleared journal is created to conceal the failure.

## Verification and limits

- Node controller regressions exercise blocked reads, failed toggles/mode,
  attempt failure, explicit recovery, malformed retained time and reset.
- Adapter tests cover lazy property access, all storage methods, partial reset,
  historical keys/defaults and error redaction.
- Strict checkJs checks the actual adapter body, discriminated results, negative
  consumers and an intentionally mutated timestamp implementation.
- `runtime_credit_preferences.py` uses actual Kupa composition/UI and native
  IndexedDB in disposable profiles: blocked read, attempt write, disable write
  and partial reset. Main/Shared raw records remain unchanged for settings-only
  failures. Confirmed reset preserves the note ID/content through real journal
  recovery and fresh-page restart.
- `--baseline` substitutes the previous controller only in the disposable site
  copy; `--phase` limits a focused local run. CI runs all four profiles.

Exceptions and Finance/Bridge responses are controlled synthetic boundaries;
these tests do not exhaust disk capacity, contact issuers or prove cross-tab
preference coordination. Existing account/leadership, Finance/IDB/PostgreSQL,
offline/recovery and Windows gates remain required. This slice does not change
persisted schemas, SQL, ACK, Finance wire format or provider retry/fallback.
