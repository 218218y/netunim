# Staged asset verification

The managed pre-commit hook previously spawned `git show :path` for every asset
read, including repeated reads of identical shared blobs. The snapshot now captures
the index's object IDs, reads through one scoped `git cat-file --batch` process and
reuses already read blob bytes. The worker closes before applying either plan.

The existing two-plan sequence remains: validate the complete index and worktree
plans before changing either, then preserve any intentionally unstaged content.
Binary bytes and checkout newline policy retain their existing behavior. Missing
or malformed Git blobs fail before applying the generated outputs; an unresolved
index is rejected. Asset selection, hashing and generated service-worker rules
are unchanged.

The [focused Windows measurement](evidence/staged-asset-read-20261018.json) read
60 shared JavaScript paths twice. The read loop took 7.006 seconds before and
0.048 seconds after, with identical aggregate content hashes. This single sample
does not establish total commit, app startup, physical hardware or provider timing.

Native Git tests in `sync_assets_contracts.py` cover partial staging, installed
hooks, binary/Unicode paths, later index changes and missing blobs without output
mutation. The Windows workflow now runs the staged snapshot/hook contracts too.

Focused reproduction:

```text
python tests/sync_assets_contracts.py StagedAssetContracts
python tools/sync-assets.py --check
```

The remaining asset normalization, ordering, removal and idempotence contracts run
in the existing complete repository verification.
