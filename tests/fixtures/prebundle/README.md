# Historical ESM-to-bundle migration fixture

`source.zip` retains the original public application files from repository commit
`4d8e17d34974799ad3666204d349ed198a2fa4cb`, before Production Build migration.
`manifest.json` pins the archive and every included file. Reproduce it with
`python tools/capture-prebundle-fixture.py` from a checkout containing that commit.

Vendor binary trees are omitted to avoid duplicating the pinned runtimes. The
original runtime manifests are included. The restorer only reuses current vendor
trees when their manifest bytes and every declared file SHA-256 match the original
fixture; a later runtime upgrade must retain its genuine historical tree instead.

The browser scenario runs historical modules and the historical worker without
instrumenting them, seeds synthetic Main/Shared V2 records through their existing
journal APIs, swaps the server deployment pointer to the actual compiled output,
and later rolls back to historical files. It does not substitute current source
for historical modules or retain source files under the compiled public root.

Cloudflare's authenticated deployment listing reports `4d8e17d` for both current
Production deployments: Orders `5c873855-01f1-4aa6-a96a-8a9ffd759f58` and Kupa
`6a43e10a-cced-4562-9b32-ee6df0cf76fd`. The public site trees also match the
pre-build repository baseline `7e9c1eb0` byte-for-byte. Direct HTTP snapshot access
was blocked by the filtered local network, so deployment **byte identity remains
unverified**. Confirm each deployment's release header and
worker bytes before the first live rollout. Historical workers cannot be patched
by new workers; close all old tabs/windows at the documented maintenance boundary
before relying on a newly deployed vendor-runtime compatibility protocol.
