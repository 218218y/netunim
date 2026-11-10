# Bank Bridge 80: CAL debit classification and MAX promotion memos

Reviewed against local main `12704a91` on November 10, 2026. No live bank or
credit account was accessed. There were no open PRs in `218218y/netunim` at review.

## Evidence and decisions

- [Latest release v6.13.0](https://github.com/eshaham/israeli-bank-scrapers/releases/tag/v6.13.0),
  published November 2, adds MAX promotion memos. The
  [6.10.0 to 6.13.0 source comparison](https://github.com/eshaham/israeli-bank-scrapers/compare/v6.10.0...v6.13.0)
  changes MAX memos and CAL frame/balance handling but does not change their login
  implementations, Hapoalim or the browser base. Other changes concern providers
  this Bridge does not expose. Keep the pinned dependency and both lockfiles:
  local CAL frame handling already covers the relevant released change and the
  local MAX mapper needs its own memo update regardless of dependency version.
- [PR #1202](https://github.com/eshaham/israeli-bank-scrapers/pull/1202) is still
  open. The local mapper also misclassifies code `41` without installment counters.
  Add `CAL_TRANSACTION_TYPES.debit` and include it in the existing normal-code
  list. Preserve local `String()` coercion (including numeric 41), unknown-code
  fallback, installment metadata, dates, amounts and refund signs.
- [Merged PR #1214](https://github.com/eshaham/israeli-bank-scrapers/pull/1214)
  supplies the MAX `promotionClub` / `promotionAmount` memo contract. Append these
  to the existing locally formatted comment/receiver/transfer detail. Retain zero
  amounts, omit absent/blank parts and use the existing text normalization.
  `actualPaymentAmount` remains the charge; never subtract the promotion again.
  The existing final 260-character memo limit remains in force, so exceptionally
  long memos can truncate appended details.
- [PR #1212 and discussion](https://github.com/eshaham/israeli-bank-scrapers/pull/1212)
  still describe both old and new CAL login variants; both participants agree on
  supporting both. There is no new evidence of failure in this owner's working
  login. Leave `visa-cal-session.mjs`, credential submission and upstream selectors
  unchanged. A future login change needs explicit tests for both variants.
- [New PR #1220](https://github.com/eshaham/israeli-bank-scrapers/pull/1220)
  appends installment numbers to CAL IDs. This application already retains the
  installment number and billing date in its transaction deduplication and
  shared billing identity. A regression test carries two payments with the same
  issuer ID through normalization and billing consumers. Preserve existing IDs
  to avoid unnecessary changes to persisted transaction identity.
- [PR #1171](https://github.com/eshaham/israeli-bank-scrapers/pull/1171) still
  matches pending/completed purchases by merchant/day/nearest time without
  requiring equal amounts or a maximum time gap. Do not adopt it. Existing
  `shared/credit-billing-cycles.js` correlation requires unique, minute-precise
  purchase identity, signed original amount and currency in account scope.
- [PR #1199](https://github.com/eshaham/israeli-bank-scrapers/pull/1199) remains
  open. Its description acknowledges that removing `--enable-automation` alone
  does not hide `navigator.webdriver`. Retain the existing installed Chromium
  identity policy and Chromium/Camoufox fallback; no new launch flags or retries.
- Existing local browser-origin CAL requests, invalid-password/session detection,
  DigitalV3 Isracard/Amex adapters, Hapoalim date-range paging and interactive MFA
  remain in place. [PR #1182](https://github.com/eshaham/israeli-bank-scrapers/pull/1182)
  addresses a timeout already handled by the local Hapoalim login policy.

## Validation and deployment

`tests/credit_provider_updates.test.mjs` exercises completed/pending CAL codes,
regular/immediate branches, refunds, missing charges, installment metadata and
identities; MAX absent/partial/zero/positive/negative promotions, existing memo
formatting, unchanged amounts and monthly projection. The staged native Credit
test verifies that synthetic provider promotion fields reach the public sync
response without raw provider data. Existing adapter, signed-amount, billing,
partial-sync/Last Known Good and boundary suites remain applicable.

Keep the immutable historical adapter policy fixture. The separate
`credit-provider-updates-policies.json` records only five reviewed declarations:
the code table, two provider schema identities and two mappers. All login,
transport, account and fallback policies retain their previous digests.

Bridge runtime version is now 80; the credit contract remains 2. Provider schema
identities distinguish the new mappings. After updating the checkout, rerun
`netunim-kupa/bank-bridge/install_bank_bridge.bat` on each Windows computer to
activate the staged runtime using the existing installation/rollback checks.
Git updates alone do not update an already installed Bridge. No site deployment,
database migration or credentials change is needed for these mapper fixes.

Synthetic tests and CI cannot establish live provider login success. No installed
Bridge, browser profile, credentials or real financial data were changed during
this work.
