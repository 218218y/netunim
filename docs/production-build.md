# Production build migration

The source `site` trees remain the development and source-contract targets.
`npm run build` builds independent `dist/orders` and `dist/kupa` payloads.
`npm run build:orders`, `npm run build:kupa` and `npm run build:check` are
available separately. Do not upload `.work`: private source maps, module graphs,
bundler metadata and release manifests live in `.work/production/<app>`.

## Tool decision (2026-10-30)

Both alternatives were tried against both real applications. The optional
`tools/build-poc.mjs` reproduces the Vite 8.3.5 comparison after installing it
under `.work/build-poc`. Vite successfully compiled both graphs, but its default
asset processing also transformed the pinned PDF.js modules and document viewer
scripts. It requires explicit integration for our classic importScripts worker
and for computed font/CMap/WASM paths, rather than its default worker rewrite.

The production implementation uses exactly locked esbuild-wasm 0.28.2. Its
portable npm archive is included in the integrity-verified offline toolchain;
no platform-specific binary installer or network access is required to build.
It deliberately externalizes the pinned vendor modules and preserves each
source module's original virtual URL base for relative runtime resources.
WASM compilation is slower than the native Vite proof of concept; portability
and a small, explicit integration surface take precedence for this migration.

ESM code splitting preserves existing asynchronous feature boundaries. The
bootstrap has no static business-code dependencies; the build contract verifies
this from the emitted graph and bundler input inventory. Minification is enabled
for JS and CSS, with declaration/export tree shaking disabled during migration.
No domain initialization, persistence, schema, synchronization or financial
behavior is changed to force the build to work.

## Release and validation

The final output inventory determines the worker shell, including every dynamic
application chunk and both classic worker scripts. Large vendor trees stay lazy.
Every published byte, including vendor assets and worker behavior, participates
in the deterministic release digest. Only the derived release fields are omitted
to break self-reference. Release headers, worker identity and the private file
manifest must agree. Vendor source maps are omitted from the public payload;
all remaining vendor bytes match the integrity-pinned source runtimes.

`tools/verify-build.py` rejects modified or extra files, missing HTML references,
incomplete offline shells, secrets, dynamic execution, public source maps,
unexpected file types and Cloudflare's 25 MiB/file and 20,000-file limits.
Keep the existing source/runtime vendor integrity gates as prerequisites.

`tests/production_build.test.mjs` checks byte-for-byte repeatability, the startup
gate and tamper rejection. `tests/runtime_production_build.py` builds the real
payload and compares isolated Chromium cold, cached and offline starts against
source on the same machine. The production verification group preserves the
comparison as a CI artifact, along with original startup marks and CPU counters.
Empty synthetic local stores are used: these numbers cannot predict production
account recovery or network latency. Existing source business suites remain.

## Rollout status

The first stage introduces and verifies the build alongside existing deployment.
Deployment remains on the existing path until the output and update-compatibility
gates have passed. No Cloudflare Production deployment is authorized by a build
success alone. The two Cloudflare projects have independent deployments and
independent rollback histories; they are never an atomic pair.

Production rollout requires actual document viewer/worker probes, an old active
release opening a previously unused chunk after replacement, failure-injection
of worker installation, and preservation of local data across updates. Existing
live Supabase verification must remain immediately before each upload. Retain
the exact previously deployed payload and its receipt for rollback; never clear
IndexedDB or LocalStorage to make an upgrade succeed.

References: [esbuild API](https://esbuild.github.io/api/),
[Vite production builds](https://vite.dev/guide/build),
[Cloudflare Pages limits](https://developers.cloudflare.com/pages/platform/limits/).
