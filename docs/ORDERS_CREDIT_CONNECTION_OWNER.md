# Orders Credit local connection ownership

Baseline: `56e9620242de2679a761bdd52733d606177c0b1f` (PR #162).

Ten before-change tests reproduced late pairing status/errors, former-device
diagnostic export, superseded probes, late profile success, destructive
confirmation under a replacement pairing and a save closing a newer form.

`createOrdersCreditConnectionOwner` now owns the local pairing generation,
status/checked/Bridge-error readout and profile/diagnostic/reset requests. Its
five required ports are pairing, transport, presentation, effects and protocol.
It imports only the canonical accepted-work primitive. The whole implementation
is strict checked JavaScript, with negative consumers and a body mutation that
rejects a text label in place of confirmed command success.

Construction performs no I/O. Passive status keeps the Orders policy: no probe
without pairing, checked status even on failure, quiet failure unless requested,
and a soft probe after successful vault writes. The latest-started status owns
publication. Observed A → B → A transitions invalidate earlier A work; an
unobserved transient change cannot be inferred from a token reader. No captured
token is included in errors, diagnostics or persisted documents.

Finance still owns its Bank/Credit busy policy, account authority, provider
leases, issuer synchronization and durable document commands. Credit refresh
and reset combine the local pairing permit with account authority. Lease renewal
and release continue using the original account guard, independently of the
pairing publication fence. A changed pairing can suppress publication while
the same account still releases its lease. Controller width changes from 20 to
21 explicit collaborators; direct local Credit transport and readout ownership
leave that controller. The remaining provider/Bank orchestration is unfinished.

The connection presentation owns each native form identity, listeners and
accepted save/confirmation work. A retained save action with an old profile ID
cannot consume a new form. Only a successful save for the same current form
closes it. Hidden/cancelled native forms cannot accept retained actions or late
closure; each form also captures pairing authority when it opens. Deletion
captures local authority before confirmation; complete
reset also captures Finance authority before confirmation. Unavailable reset
authority reports through the existing toast and starts no confirmation or I/O.
The unused public field-update helper is retired; its implementation is private.

Finance exposes `runtime.isPending()`, `drain()` and idempotent `dispose()`.
Controller work (including automatic preflight/cleanup), connection work,
archive reads and presentation confirmations remain joinable after closing.
Closing rejects new commands and suppresses late effects; accepted requests
are not aborted or presented as completed. Browser URL/anchor cleanup remains
owned by the existing effects adapter.

Frozen fixtures retain five issuer/transport/document implementation hashes,
six Bank workflow AST hashes and the credential payload AST. Password whitespace
and ID/card leading zeros, protocol 73/2, cloud RPC/wire formats, retry/fallback,
deployed SQL and persisted schema are unchanged. These are algorithm preservation
checks, not substitutes for behavioral tests.

Nine production browser cases exercise status success/failure, diagnostics,
deletion/reset confirmation, replacement/cancelled forms, stale form credentials
and disposal. They cross the
real loopback decoder and native DOM/IDB boundaries, compare Main/Shared journal
records exactly and reload a durable note with the same ID/content. Unit cases
also exercise observed pairing generations, protocol versions, account changes,
accepted failures, reset/probe ordering and Finance publication/lease cleanup.
The first full CI run reproduced an unreadable local token escaping a snapshot
(`SecurityError`). The owner now invalidates pairing evidence on unavailable
storage without breaking readout; existing sanitized preference warnings remain
responsible for reporting. Restoring readable storage creates a new generation.
The existing production Bank/Credit token-fault cases protect this behavior.

Historical persisted readers are retained. Deploying new JavaScript does not
convert older IndexedDB records or imported backups. This slice retires a proven
unused API, not historical data support or deployed migrations.
