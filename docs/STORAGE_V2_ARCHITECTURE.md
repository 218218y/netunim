# Storage V2 architecture

This document describes the current production storage path. Historical rollout
and cleanup decisions are recorded in [STORAGE_V2_CLEANUP_STATUS.md](STORAGE_V2_CLEANUP_STATUS.md).

## Ownership and local durability

Each application has a durable storage owner binding. Authentication authorizes
cloud access; it does not silently change the owner of the visible local data.
Main Orders and Main Kupa each use a typed-operation IndexedDB journal. Shared
Checks uses its own journal and is the sole owner of `checks` and `bankEvents`.
Main checkpoints use projection 2 and cannot contain `checks`. The visible
model is composed from recovered Main and Shared state before business editing.

A fresh local installation creates both journals through local birth. Import
and restore use coordinated durable boundaries across Main and Shared. Cloud
sync adds a base, cursor, immutable flight, acknowledgement and rebase to the
same journals. Owner transfer prepares and verifies a detached target before
activating it. An authenticated account with server protocol 2 but no local
account marker installs verified cloud Main and Shared heads atomically; old
local business records are not consulted or uploaded.

## Activation and writer safety

The account marker and local engine marker are durable IndexedDB records. Their
LocalStorage values are synchronous routing caches only. The historical
physical store `cutovers` and key prefixes are preserved for existing V2
browsers. `storage-v2-activation-cache.js` is the single place that interprets
both cache keys. Startup verifies the durable record before exposing business
state; a cache alone cannot authorize a writer.

The server minimum writer protocol remains a permanent fence. Current clients
use v6 RPC writers and cannot write directly to the business document tables.
The Main and Shared journals reject a missing or mismatched owner, an invalid
checkpoint, and operations against collections outside their schema.

## Compatibility boundary

Current code does not read or write business Storage V1 records. The small
`storage-v2-persisted-compat.js` module classifies records created by earlier
V2 releases, including historical bootstrap intents and Shadow roles. It does
not create those records or promote an old Shadow checkpoint. Its removal needs
proof about existing V2 records on supported computers, not a V1 migration.

The read-only `list_incomplete_restore_groups_v5` RPC is still a production
endpoint. Public legacy writer RPCs have been revoked but are still present in
the database schema; a live dependency audit is required before a new migration
drops them. Applied migrations must remain unchanged.
