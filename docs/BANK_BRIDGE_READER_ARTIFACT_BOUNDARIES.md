# Bank reader and local artifact ownership

This stage starts from `29c639240fe4c41554ada3c57d4efc5c5b2a6378`. The existing
provider/session and HTTP owners remain canonical. Account reads, supplemental
transaction details, cheque images and installed-browser discovery now have
separate, inert capabilities instead of parallel implementations in the server.

## Evidence before changing behavior

Characterization exercised the actual server functions before extraction, using
synthetic bank responses and native temporary files. Twelve cases passed. One
fault case failed: after the binary temporary image was written, a rejected
temporary metadata write left the binary attempt behind. Normal cache housekeeping
recognized only final `.bin`/`.json` pairs and therefore could not clean that
attempt. The after-change fixture exercises the actual extracted implementation;
the temporary VM/source-extraction harness is removed.

The fix places cleanup next to the operation that created each temporary path.
Image publication and date refresh remove their own attempts in `finally`, using
settled cleanup so the original publication failure remains authoritative. This
does not claim power-loss cleanup or introduce a new persisted cache format.

Two further fault cases proved that the original parallel read/delete pairs
returned after one rejection while their sibling file attempt remained running.
They now join every accepted attempt before returning failure. Both regressions
failed before the join change and passed afterwards; the first observed error
and fail-closed read result remain unchanged.

## Boundaries

| Module | Public capability | Required ports and responsibility |
| --- | --- | --- |
| `hapoalim-json.mjs` | `read` | Session readiness; serialized authenticated JSON fetch and bounded transient navigation recovery |
| `hapoalim-enrichment.mjs` | `enrich` | JSON reader, cheque attachment, transaction diagnostics; posted/pending policies and distinct supplemental detail sources |
| `hapoalim-accounts.mjs` | `read`, `lookbackDays` | Session, JSON, enrichment, account diagnostics, date clock; account selection, recursive windows, coverage and partial home results |
| `cheque-images.mjs` | `read`, `attach`, `inRetention`, `cleanup`, `clear`, `drain` | Directory, date/time clock, reporter, native file adapter; verified image bytes and owned temporary/final files |
| `file-task-owner.mjs` | Owner: `run`, `drain`; `joinFileAttempts` | Private FIFO completion chain and complete sibling-attempt joining |
| `browser-locator.mjs` | `find` | Explicit OS candidates/access/where ports and browser metadata; private cached path |
| `windows-browser.mjs` | `browserCandidates` | Concrete Windows candidate paths, preserving their original priority |
| `hapoalim-wire.mjs` | Constants | Canonical bank origin, 183-day image retention and 5 MiB size limit |

Domain orchestration has no filesystem, HTTP listener, timers or direct fetch.
Serialized browser fetch callbacks live in the JSON/image adapters. Discovery has
no process-spawning or credential authority; the composition binds its bounded
`where.exe` command and native filesystem access. Constructors initiate no I/O.

The account factory requires five collaborators, enrichment three and discovery
two. Import/collaborator budgets and exact public API checks prevent these
boundaries from silently growing. The server no longer defines the extracted
reader, image or browser algorithms.

## File and shutdown ownership

Reads, image publication, date refresh, housekeeping and cache clearing share a
private file queue. A reader waits for a currently accepted two-file publication;
it cannot observe the moment between binary and metadata promotion. Rejections
are delivered to their caller and do not poison subsequent jobs. Drainage joins
work accepted while an earlier job finishes.

Browser downloads run outside this file queue. Their bank provider command
already retains its browser/session obligation through completion. A stalled
provider download does not hold unrelated cache reads behind network work.
Configuration cleanup still uses the established Bank operation owner, so cache
clearing cannot race an active provider command.

Shutdown closes public admission, drains accepted provider/configuration work,
then joins both the diagnostic and image file queues before closing the listener
and exiting. A disconnected image HTTP client does not release the file job.
This supplements the existing vault/provider shutdown ownership.

Serialization is scoped to one running Bridge instance; it does not provide a
cross-process transaction or atomic durability across both final files. Existing
invalid-pair reads fail closed. Best-effort removal cannot guarantee deletion
when the filesystem itself refuses cleanup. No crash janitor or historical
compatibility retirement is claimed by this stage.

## Preserved policies and checks

The historical provider/session fixtures remain unchanged. The read fixture
captures 23 function AST digests from the starting commit, including recursive
window selection, dual-account results, JSON retries, detail enrichment, image
URL/bytes/identity/retention and installed-browser priority. Canonicalization
maps only named clock/platform/report transports and the three explicit queued
file calls back to their original calls. Mutation tests prove that changes to
image retention, browser priority, terminal cleanup and provider fallback fail.
The named sibling-attempt join maps back to its former `Promise.all` transport;
native rejection/held-sibling tests protect its strengthened completion policy.
Temporary writers are intentionally outside this immutable comparison because
their proven failure cleanup changed; native file fault tests cover them.

Focused behavior checks cover:

- Required business balance, isolated home errors, duplicate account roles and
  incomplete transaction results.
- Non-overlapping recursive full-page windows, preserved duplicate rows and all
  365 backfill days within the existing 60-day chunk policy.
- Transient navigation retries, stale readiness and non-retried HTTP errors.
- Pending cheque/issuer rows, separate PFM/cheque detail sources, posted issuer
  card identity and a shared detail URL fetched once.
- Exact native image bytes/schema, URL/MIME/retention gates, malformed pairs,
  held metadata promotion, rejected publication/refresh and later queue recovery.
- Valid persisted browser hints, candidate order, `where` fallback, private path
  reuse and original non-Windows/not-found errors.

Strict `checkJs` checks the actual file owner and browser locator, valid/invalid
consumers and deliberate mistakes in their actual implementations. Browser and
native file payloads are not presented as fully typed by this stage.

Native staged-server tests join the real HTTP/provider/reader/artifact modules.
A held image read remains owned after client disconnect and shutdown, then
completes before normal process exit. The required Windows gate runs this case,
cache fault tests, native provider cleanup and CurrentUser DPAPI together. The
installer's transitive module closure is checked before staged startup.

Remaining Bridge work includes larger issuer adapters, additional diagnostic/
metadata artifact writers, and Document search/scheduled maintenance boundaries.
Synthetic responses and CI do not replace controlled live-provider and two-device
checks described in the overall architecture plan.
