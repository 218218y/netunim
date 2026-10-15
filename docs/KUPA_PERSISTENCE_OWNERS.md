# Kupa persistence authority

`storage/persistence.js` composes eight roles and owns accepted-work admission
and draining. It delegates to four owners with distinct responsibilities:

| Owner | Responsibility |
| --- | --- |
| `local-commit.js` | Validate the mutation synchronously, normalize, submit the existing V2 operation and wait for its durability receipt before publication |
| `save-publication.js` | Serialize file mirrors, coalesce unpublished cloud requests, and route a save through the current storage mode |
| `local-file-mirror.js` | Prove Main and Shared journal parity, reject external revision changes, write the verified file and backup |
| `local-file-adoption.js` | Adopt a file through the existing durable two-journal boundary before replacing the visible model |

`main-state.js` defines the existing Main-only comparison: checks and transport
metadata cannot stand in for Main authority. Connectivity enters through a
synchronous view port. The production factory has no flat compatibility API;
historical test stand-ins are translated in `tests/kupa_persistence_ports.mjs`.

The immutable policy fixture was captured from `aa12f2f3` before extraction.
Tests compare mutation admission, normalization deletion evidence, import and
the combined routing/mirror algorithm against it. Separate behavior tests cover
an accepted file write followed by a switch to cloud publication and prove that
only unsubmitted cloud generations are coalesced. Existing tests cover failed
IDB commits, owner/account replacement, two-journal imports, unjournaled checks,
external file conflicts, immediate synchronous rejection and accepted-work drain.

These are ownership extractions. V2 journal bytes, cursors, mutation algorithms,
cloud ACK policy, file revision format and conflict recovery remain unchanged.
