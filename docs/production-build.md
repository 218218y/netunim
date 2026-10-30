# Production build migration

The source `site` trees remain the development and source-contract targets.
`npm run build` builds independent `dist/orders` and `dist/kupa` payloads.
`npm run build:orders`, `npm run build:kupa` and `npm run build:check` are
available separately. Do not upload `.work`: private source maps, module graphs,
bundler metadata and release manifests live in `.work/production/<app>`.
Each app has an exclusive build lock and a temporary staging directory. Failed
compilation/validation leaves the last verified public/private output in place;
publication restores the previous pair if a move fails. Linked output parents
are rejected before writing. If publication recovery itself fails, the staging
directory and lock remain for inspection instead of deleting recovery copies.

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

## Deployment and rollback

Both normal and fast entrypoints retain their source verification and security
guards, then compile the selected application and validate the final output
before the live Supabase gate. Wrangler receives the exact retained copy of the
verified `dist/<app>` payload selected for that upload, so a concurrent later
build cannot replace the uploaded bytes or change the receipt's release identity.
`--preflight-only` also builds and validates, but exits before retaining a release
or starting Wrangler. Fast deploy still requires full CI for the exact clean
commit; it does not skip output or live database validation. Install the locked
dependencies with `npm ci --ignore-scripts` before using the build/deploy tools.

Before an upload, `.work/releases/<app>/<release>/site` retains the exact payload
alongside its private manifest. A modified or incomplete snapshot fails closed.
`python tools/deployment-receipt.py verify orders <release>` (or `kupa`) prints
the verified rollback directory without rebuilding it against newer sources.
After upload, `.work/deployments/<app>` records commit, release, project, exit
status and the deployment URLs printed by Wrangler. Wrangler output is displayed
when the upload finishes; authenticate the CLI before starting a deployment.
An upload failure remains a failure even if a receipt was recorded. A successful
upload whose receipt failed is explicitly reported for inspection before retry.

For rollback, first verify the retained release and run the existing live
Supabase gate. From an isolated directory, deploy that retained `site` directory
using the repository-pinned Wrangler version and the matching `bargig-orders` or
`bargig-kupa` project. Never rebuild old sources using current dependencies to
approximate the old payload. Retain previous Cloudflare deployment IDs/URLs from
the receipts as an additional provider rollback route. Local data needs no reset.

No Cloudflare Production deployment is authorized by a build success alone.
The two Cloudflare projects have independent deployments and independent rollback
histories; they are never an atomic pair. This migration does not deploy either.

The production runtime gate includes actual document viewer/worker probes, an old active
release opening a previously unused chunk after replacement, failure-injection
of worker installation, and preservation of local data across updates. Existing
live Supabase verification must remain immediately before each upload. Retain
the exact previously deployed payload and its receipt for rollback; never clear
IndexedDB or LocalStorage to make an upgrade succeed. The source tree remains
available for development and existing source contracts; the uploaded payload
contains only its compiled runtime and required public resources.

## Observed baseline and build comparison

The first GitHub Chromium comparison (run 40996716543) measured 415 to 16 initial
JavaScript requests in Orders and 319 to 11 in Kupa, a reduction above 96% for
both synthetic empty-store starts. Decoded JavaScript bytes also decreased, and
cached and offline starts passed. Worker installation inventories fell from 524
to 54 resources in Orders and from 371 to 39 in Kupa. These are measurements and
inventories from this revision, not a promise of seconds saved on user hardware.
Existing startup suites independently measure recovery, first view, command
readiness and CPU-throttled starts. The production comparison repeats three cold,
cached and offline samples for both source and output at normal and 4x CPU
throttling. It retains raw marks/CPU counters, per-profile medians and maxima,
without inferring exact parse times from elapsed module evaluation. Output
runtime evidence is retained alongside the source suites. Offline samples also
disconnect the test server, because page-level CDP network emulation alone does
not necessarily cut off a Service Worker's network requests. The source shell
includes every first-party stylesheet as well as the application modules.
Broader real-account,
physical weak-hardware and filtered-network acceptance remains
a rollout gate before a live deployment, not something inferred from byte sizes.

Production validators use explicit exceptions rather than Python assertions;
`python -O` and `PYTHONOPTIMIZE` cannot disable their checks. Contracts inject
tampered current and retained assets under optimized Python. Build-lock, failed
publication, linked-output and frozen-upload scenarios are tested separately.
Cloudflare combines duplicate header values across matching rules, so the source
global `no-cache` policy is narrowed to mutable output paths. The global security
headers remain intact, hashed assets inherit only the immutable cache policy,
and vendor/HTML/config/worker paths retain `no-cache`. Effective merged headers
are covered by a dedicated contract. See [Cloudflare header rules](https://developers.cloudflare.com/pages/configuration/headers/).
The native HTTP harness applies only matching rules and joins duplicate values,
matching Pages behavior. Redirected HTML responses are normalized before caching
and canonical extensionless HTML URLs (including query parameters on the reset
page) recover their own document offline rather than falling back to the index.

References: [esbuild API](https://esbuild.github.io/api/),
[Vite production builds](https://vite.dev/guide/build),
[Cloudflare Pages limits](https://developers.cloudflare.com/pages/platform/limits/).
