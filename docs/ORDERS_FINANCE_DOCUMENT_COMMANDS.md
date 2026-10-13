# Orders Finance document commands

This stage starts at tested main `79b7ed86438aa2a4f3bfd45b969d653189140b6e`.
The private Finance controller still owned Main/Finance rebase loops, receipt
decoding, manual lease queuing and display confirmation alongside Bank/Credit
provider orchestration and UI commands.

## Ownership and current APIs

`document-commands.js` receives six ports: operation scope, Kupa document,
Finance document, leases, readout and delay. Construction performs no read,
write or lease acquisition. It exposes three commands (`mutateKupa`,
`mutateFinance`, `publishBankSnapshot`) and one Finance query. Operation IDs,
conflicts, manual FIFO edits and confirmation stay within that owner. Queries
capture read authority; mutations capture write authority. Waits use the Finance
effects port rather than an implicit queue timer.

`kupa-write-state.js` owns pure Kupa projection, stripping Finance payloads while
preserving existing manual balance and snapshot watermark rules.
`document-publication.js` owns readout confirmation after a valid write receipt.
A committed document and a verified display remain separate results; an
unverified display retains the existing operator warning.

The Finance capability constructs this owner and supplies the controller with
its narrow API. The controller no longer receives raw document writers or
atomic snapshot transport. Collaborators decrease from 30 to 23. Lease
claim/release is an explicit required port; a default stub can no longer
manufacture an acquired lease. Main imports remain 56.

## Retirement evidence

The production capability already required isolated Finance and atomic Bank
snapshot RPCs. The audit found one production controller construction site;
old direct tests still supplied partial controllers. A pre-change synthetic
proof showed a Finance edit with absent Finance ports returning success after
reaching a Kupa Main write. This proves the fallback existed, not a production
data-loss incident.

Finance cannot now fall back to embedding its state in Kupa. Bank publication
cannot fall back to separate Finance and Kupa watermark writes. An unknown
atomic acknowledgement remains unknown, without another write or provider scan.
Complete ports are validated before any operation. Tests use the actual command
owner with explicit synthetic ports; read-only fixtures reject unexpected writes.
No production adapter retains the old flat controller write API. Historical-data
readers are unchanged.

## Preservation and verification

Four pre-extraction digests protect Kupa projection, Kupa mutation, Finance
mutation and display confirmation. The Finance comparison excludes only the
explicitly recorded obsolete fallback and optional writer check now enforced
at construction. Mutations detect changed raw receipt selection, operation
identity, stripping and scope checks.

Focused tests cover FIFO contention, remote edits while waiting, conflict rebase
with one operation ID, separate document state, unknown atomic receipts and
post-commit warnings. Existing controller tests retain handoff, lost responses,
exact archive identity, no-op/replay receipts, independent heads, settings and
atomic Bank semantics. Native browser/IndexedDB confirmation cases preserve
exact data and journal cursors and recover by reading without duplicate writes.

The actual publication body and negative consumers are strict `checkJs`; a
mutation of boolean status to display text fails compilation. Full mutation,
Bank/Credit payload and lease caller typing remains incremental work. Complete
controller/writer typing is not claimed. Generated PWA manifests include all
three modules, and full branch CI covers database, browser/IDB and Windows.

Private Bank/Credit workflows and archive/readout responsibilities still need
decomposition. Provider, RPC, schema and persisted-format semantics are
unchanged. See [remaining major work](ARCHITECTURE_REMAINING_WORK.md).
