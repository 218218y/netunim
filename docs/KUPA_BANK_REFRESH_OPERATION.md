# Kupa Bank refresh and candidate ownership

`domains/bank/refresh.js` now owns the full accepted Bank operation: automatic
cloud preflight, lease acquisition, freshness recheck, Checks barriers, supported
paired device status, provider scan, archive reconciliation, candidate calculation,
cloud/local publication and joined lease cleanup. Its seven required role APIs
are account authority, cloud readout, device, leases, publication, candidate policy
and automation. The strict operation starts no work during construction.

The controller decreases from 17 to 13 collaborators. It retains admission,
preferences/scheduling, archive pause/resume and presentation/local scan feedback.
It no longer calls providers, holds leases, reconciles archives, selects backfill
or builds/publishes provider candidates. Its refresh presentation is formatted
locally; unrelated controller and repository formatting is unchanged.

## Candidate and publication timing

The strict three-port `snapshot-policy.js` has calculation, source and identity
APIs and cannot access providers or persistence. Preparation projects prior
business/home feeds, recurring-debit history, warnings and baseline audit before
the second Checks barrier. Final building reads the observed Shared sequence,
snapshot token and current date/time after that barrier. This intentionally
preserves the original evaluation timing across asynchronous verification.

Cloud manual scans use 365 days only for an unverified archive; other scans use
30. A baseline is initialized only from complete business and any configured home
coverage without a home failure. Partial home results preserve the previous home
feed; partial/rolling results retain the last verified baseline audit. Nullable
financial fields use the real balance decoder and never become invented zeros.

Cloud publication remains one atomic snapshot RPC with independently verified
Main/Finance receipt heads. Missing follow-up readout remains a visible warning.
Local/file publication stays with the existing durable local snapshot owner;
unconfirmed candidates retain their existing retry path without another provider
or cloud fallback. The retained local guard now explicitly includes refresh
lifetime and account/pairing, independently of the completed provider lease.

## Authority and evidence guards

The operation tracks work before acquisition. Disposal stops renewal, fences late
continuations and retains accepted requests for drain. Cleanup joins provider,
publication and pending renewal before releasing under the captured account.
Pairing replacement and component disposal retain same-account cleanup; account,
login or leadership changes leave the former lease to TTL. Drain is not an ACK.

A local-only lease is valid for file/local mode but cannot authorize a cloud-mode
provider scan, reconciliation or publication. A malformed non-object home-failure
envelope is rejected before reconciliation instead of being interpreted as usable
partial-result evidence. Both guards preserve previous data and normal cleanup.
Nested transaction/status schemas remain separate contract work.

## Verification

- Immutable full refresh, feed projection and shared-clock functions were captured
  before editing from main `cc6a33d65c11454f12a6d4e0dcfde74e7b371b3b`.
  Characterization recomposes the actual operation, actual policy and actual
  presentation callbacks. Only explicit role substitutions and the separately
  tested new lifetime/evidence guards are reversed. Older archive, lease, balance
  and snapshot fixtures remain fixed.
- Mutations change provider scope, backfill, home retention, watermark and awaited
  cleanup to prove characterization can detect changed business policy.
- Strict consumers and implementation mutations reject deferred authority,
  fabricated publication, textual money/watermarks and unjoined completion.
  Candidate tests cover late identity/watermark capture, verified/partial/local
  archives, home LKG and forged financial evidence.
- The registered native archive lifecycle suite expands from two to nine stages:
  preflight, acquisition, first Checks barrier, status, provider, transactions,
  archive, second Checks barrier and publication. Every stage covers account,
  pairing and disposal, exact Main/Shared IDB retention and fresh-runtime recovery.
  Native envelope cases also cover local-only cloud grants and malformed home
  failures. Full PostgreSQL, browser, Windows and model CI remains mandatory.

This completes provider-refresh coordination for Bank/Credit in both apps.
Broader financial edit/manual-queue contracts, Calendar/Customers, Document Bridge,
backup resources and measured startup remain open. No RPC/schema/migration,
Bridge version, provider retry/fallback or local publication policy is changed.
