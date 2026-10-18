# Entry contract for a new feature

This is the common review contract for extending the current composition and
capability boundaries. It does not require replacing working domain facades.
Kupa's `composition/bank.js` demonstrates explicit commands, queries, presentation,
runtime and action registration. Existing smaller facades can keep their shape.

| Boundary | Required feature contract |
| --- | --- |
| Business authority | Identify the existing owning Main, Shared Checks, Finance, Calendar or independent workbook path before adding a command. A localStorage preference or file/Bridge mirror cannot become another business writer. |
| Durable mutation | Submit domain operations through that owner's existing commit/command API. Extend the operation decoder/schema and domain validation when adding a new field or collection; a visible model assignment is not a journal receipt. See `shared/storage-operation.js`. |
| Multiple owners | Use the existing coordinated boundary for Main/Shared import or restore. Keep source ACK/revision proof and retained recovery intent; do not issue independent replacements that can leave half an import. See `shared/storage-v2-local-import.js`. |
| Input and lifetime | Capture account epoch, durable owner/leadership and operation scope before the first async effect, including a native picker. Decode and detach external replies before authority; recheck after awaits and before publishing. |
| Runtime effects | Put timers, listeners, native resources and accepted async work behind the hosting runtime's cancellation/disposal/drain ports. Drain accepted writes; cancel pending work without manufacturing success. |
| Results and errors | Distinguish local commit, remote confirmation, publication and optional mirror/cleanup. Critical persistence failures reject or retain a recovery lock. Advisory hint/cleanup failures report their limited effect without reversing an acknowledged business commit. |
| UI entry | Register actions through the hosting action pack and composition root. Commands own mutations, queries/read models own reads, and presentation consumes those ports. Reuse the existing domain capability instead of adding a second transport or persistence path. |
| Evidence | Add focused behavioral failure/recovery tests at the changed authority. Strict-check the implementation for a new critical boundary, with negative consumers. Keep graph/lint/readability and native release gates; report real-device/provider observations separately. |

Compatibility readers and deployed API/migration versions stay supported until
consumer and retained-data evidence justify retirement. Generated shared/site
copies are synchronized with `python tools/sync-assets.py`; they are not parallel
business implementations. See [compatibility inventory](COMPATIBILITY_INVENTORY.md),
[current backlog](ARCHITECTURE_REMAINING_WORK.md),
[credential authority](KUPA_AUTH_SESSION_AUTHORITY.md) and
[source transitions](KUPA_LOCAL_SOURCE_TRANSITIONS.md).
