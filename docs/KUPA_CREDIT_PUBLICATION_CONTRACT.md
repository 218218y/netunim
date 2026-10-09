# Kupa Credit: confirmed commit and local follow-up

## Evidence

Baseline: `ee89ae0bbfc3e3f9af12167465303235ac86bcbf`, after Morning ownership
PR #106. Full verification run `37902246054` passed its eight groups, Windows
gate and aggregate for branch head `c9ac07eba7006152c81857805d2f1e3b6d5fe5f1`.
That is prior-stage evidence, not evidence for this change.

Test-only commit `960ecd3e27e8f20dfb82a67094c9c7def134b837` reproduced six
failures: refresh, settings and reset, each with a false or thrown local
follow-up after a confirmed Finance write. Refresh/reset could report ordinary
success after `saveState` returned false, or misclassify a thrown follow-up as
a provider failure. Settings could report failure despite confirmed remote
commit. Diagnostic CI runs `37903680843` and `37903688862` are deliberately
red at that test-only revision. There is no proof of production data loss.

## Four independent facts

1. Finance's `saved:true` confirms the remote write under the captured account,
   login epoch and live writer authority. A rejected write does not publish
   the candidate. The existing transport owns its RPC receipt validation.
2. The authoritative result is synchronously published to the Credit read model.
   This is not proof of local journal durability or completed Main sync.
3. The local persistence follow-up must return exactly `true` to confirm its
   completion. False, missing confirmation or a thrown ancillary error retains
   a separate visible warning. They cannot undo the confirmed Finance commit.
4. A computer backup is another result. This warning does not certify a backup
   or redefine the remote ACK.

`saveState` aggregates local persistence and subsequent Main/file work. False
does not prove that no local commit occurred. The UI therefore says completion
was **not confirmed**, rather than claiming local data was lost. Credit's
`remoteCommitted`, `displayPublished` and `followupConfirmed` result fields
remain separate in the checked implementation.

## Owner and revision rules

`domains/credit/publication.js` owns this policy with four ports: remote commit,
synchronous publication, local follow-up and authorized Finance read. It has
no browser globals and no universal app context. Both settings and provider
results use it. The existing operation scope guards every asynchronous
boundary; authorization loss is still an operation failure, not an ancillary
warning. The previous login's receipt is not exposed or replayed by a new login.

A delayed lower committed revision cannot replace a newer displayed result.
An old follow-up or old recovery read cannot clear the newer receipt's warning.
Historical port results without a revision remain usable at commit, but recovery
requires a verified, positive integer Finance head at least as new as the known
committed revision. The real transport returns revisioned receipts.

The warning belongs to this runtime, not a new persisted queue or journal schema.
After reload the existing durable recovery and independent Main/Finance status
owners decide readiness. This change does not claim the transient warning itself
survives reload, or that all remaining Bank/Finance unsaved paths are covered.

## Operator recovery

- **Confirmed cloud write plus local warning:** expand Credit sync options and
  choose “בדוק וטען מהענן ללא סריקה”. This re-reads the authorized Finance
  document and retries the local follow-up only. It does not rescan issuers,
  reset profiles, acquire a provider lease or write Finance again.
- **Read unavailable or older than the receipt:** retain the last confirmed
  display and warning. Restore connectivity and repeat the read-based action.
- **Provider/Finance write failed before confirmation:** retain Last Known Good
  and the existing failure diagnostics. A failed candidate is not a durable
  offline outbox; do not treat it as queued for automatic completion.
- **Account or leadership changed:** use a fresh authorized runtime and read.
  The former operation cannot publish or clear warnings under new authority.

Main, Shared Checks and Finance retain separate status ownership. The Credit
warning does not change a Main conflict into synced, fabricate a journal ACK,
or weaken startup/read-only guards. The new action is not allowed in a secondary
tab; its controller also captures live write authority.

## Verification and limits

- `kupa_credit_publication_results.test.mjs`: six before-fix regressions across
  refresh/settings/reset, UI warning and independent provider/commit counts.
- `credit_publication.test.mjs`: false/missing/thrown follow-up, no-op and failed
  writes, read-based completion, unavailable/older reads, competing receipts,
  and authorization loss during commit/follow-up/recovery.
- Strict `checkJs` checks the implementation body and negative consumer cases:
  asynchronous publication, cached authorization, serialized revisions and
  truthy-string confirmation must fail. A mutated actual implementation is
  rejected too.
- `runtime_credit_publication.py` uses actual Kupa composition/auth, six
  controlled follow-up failures, actual IndexedDB retention and successful
  journal recovery, delegated recovery action, stable note/transaction IDs and
  fresh-page recovery. Finance/provider responses and false/quota-shaped
  follow-up failures are injected; this is not actual quota exhaustion or a
  live issuer/production Supabase experiment.
- Existing Browser/PostgreSQL, offline/reconnect, lost response, Main/Shared,
  ownership and two-computer suites remain full gates. No schema, wire format,
  SQL, ACK, provider fallback, cooldown or retry budget changed.

Rollback is the previous reviewed application revision with compatible stored
records. It needs no migration, journal cleanup or deletion of pending work.
