# Orders Bank local connection ownership

Baseline: `bb520d32707525d236edcc3bcd6dd4a99380f673` (PR #164).

Seven tests against the actual Finance controller failed before the change:
late status success/error, former-device diagnostic download, completion of
configure/select/delete after pairing replacement, and a credential write
fabricating an unobserved Bridge version. These are publication and authority
defects; no claim of journal corruption follows from them.

`createOrdersBankConnectionOwner` owns local status/checked/Bridge-error,
credential/account commands and diagnostic publication. Its five required
ports are pairing, transport, presentation, effects and protocol. The actual
implementation is strict checked JavaScript; negative consumers reject numeric
account identifiers, asynchronous authority, asynchronous download acceptance
and textual command confirmation. A mutation of the implementation's confirmed
success fails type checking. Only the canonical accepted-task and pairing owners
are imported. Construction performs no I/O.

Pairing observation exposes only paired availability and an invalidation
generation. It never publishes a token. Missing/unreadable storage clears local
readout and passive probes perform no I/O. Latest-started status owns publication;
successful vault writes supersede earlier probes, including probes started
during a write. Local writes are serialized. Old device results/errors cannot
download data, notify the user or publish readout after replacement or disposal.
Observed A → B → A transitions invalidate earlier A permits; unobserved
transitions cannot be inferred from a token reader.

Credential whitespace and account leading zeroes are preserved, and selection
still defaults unknown roles to business. Confirmed vault writes do not invent
version evidence: a version already observed from that same device is retained,
or the version remains unknown until a status response supplies it. Orders Bank
requires v74 from its connection owner; Credit keeps its independent v2/minimum
v73 contract. Provider retry/pagination/partial-home semantics, financial payloads,
SQL, vault formats and journals are unchanged.

The Finance controller now consumes this owner and retains its financial busy,
account, lease, archive and durable publication responsibilities. It has 22
explicit collaborators, compared with 21 before this slice and 30 before the
document/archive work; that remaining width is unfinished work. Local Bank
transport/readout and clipboard/download ports leave the controller. Financial
Bank operations use the captured device guard while lease cleanup retains the
original account guard. The immutable historical financial algorithm is checked
after normalizing only reviewed money/device/local-status delegation changes.
The five intentionally replaced local functions are covered by scoped command
behavior and exact wire-payload checks instead of their old function hashes.

`createBankConnectionCommands` owns rendered credential form identity, captured
pairing, its submit listener and accepted presentation work. Full rendering and
incremental status rendering both bind it. Replacement/disposal releases the
listener. A stale form cannot submit to a replacement Bridge, and a completed
save cannot rerender a newer form. Delete captures authority before confirmation;
replacement/disposal while confirmation is open cannot delete new credentials.
Finance closes and drains both Bank/Credit request and presentation owners,
including confirmations already accepted at disposal.

Eleven canonical CI browser cases use production composition, native forms,
Bridge request/response decoding and IndexedDB: status success/error, diagnostics,
confirmation, request disposal, confirmation disposal, configure, select, vault
error, replacement form and stale form. Main and Shared records remain exact;
independent data restores after reload. Focused ownership, strict mutation,
architecture and immutable financial/issuer policy checks accompany them.

The duplicated local controller state, direct local Bank calls and unused
`cleanDigits` controller helper are retired. Current diagnostic JSON export is
an active user feature, not historical compatibility. Persisted readers and
deployed migrations remain pending evidence-based retirement, separately from
this local connection boundary. Kupa's corresponding local Bank connection and
larger financial/provider workflows remain unfinished.
