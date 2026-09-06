# NETUNIM offline verification vendor

This directory is intentionally populated by `npm run offline:download` rather than by `npm install`.
It is the minimal Linux x86_64 + glibc package toolchain used by the ChatGPT repair environment:

- the repository-pinned Node 24 runtime;
- the exact npm development dependency closure from `package-lock.json` (ESLint + Acorn tooling);
- the pinned pure-Python `websocket-client` wheel used by the Chromium DevTools harness.

Chrome/Chromium itself is **not** vendored. Browser binaries are normally supplied by the ChatGPT host, but a host
policy can make an installed browser unusable for localhost runtime tests. `npm run offline:doctor` performs a real
CDP + localhost navigation probe instead of assuming that an executable in PATH is usable. `NETUNIM_BROWSER` can
point to an explicit unmanaged Chrome/Chromium/Chrome-for-Testing executable when such a test browser is available.
The tooling never changes or bypasses host browser policy.

Wrangler is also excluded because it is a deployment-only CLI, not part of the verification dependency closure.

Maintenance commands (run from repository root):

```text
npm run offline:download   download/rebuild the complete package vendor in one command
npm run offline:check      verify lockfile/hash integrity without installing
npm run offline:install    install only from local archives; network is not used
npm run offline:doctor     verify vendored Node/Python plus real localhost browser capability
npm run test:offline       strict complete verification gate; browser runtime failures remain failures
npm run test:chat          repair-session command: full gate when browser works, otherwise explicit core-only gate
npm run lint:offline       run ESLint through the vendored Node/toolchain
npm run offline:update     update allowed versions, redownload transactionally, then remove superseded archives
npm run offline:clean      remove the current generated cache entry and legacy .offline state
```

`test:chat` is deliberately not a deployment gate. If the host browser is unavailable or policy-blocked, it runs
only the deterministic non-browser suites and prints that the runtime suites were skipped. `test:offline`,
`python tests/run_all.py`, `verify.bat` and deployment preflight remain strict and never downgrade to core-only.

`offline:download` and `offline:update` may be executed on Windows before uploading the repository to ChatGPT.
`offline:install`, `offline:doctor`, `test:offline`, `test:chat` and `lint:offline` intentionally target Linux
x86_64/glibc, because the vendor is a repair-environment artifact rather than a production/runtime dependency set.
Generated Linux verification packages are installed into a content-addressed cache **outside the repository**,
by default `~/.cache/netunim/offline/<profile>/<manifest-sha256>/`. Set `NETUNIM_OFFLINE_CACHE_DIR` to an absolute
external cache base when the host needs a different location; paths inside the repository are rejected. This keeps
large generated Node files out of workspace/sandbox copies while allowing separate repair copies of the same revision
to reuse one verified installation. The repository's old `.offline/` location is treated only as legacy cleanup state.

Cache publication is transactional: one process builds a complete staging directory, verifies it, and atomically
publishes it under the manifest hash while a per-hash file lock serializes concurrent installers. A changed manifest
therefore gets a different cache directory instead of mutating an installation that another repair copy may be using.
`offline:clean` removes the current manifest's generated cache entry (and any legacy `.offline/` directory); it never
creates, replaces, reads as its package store, or removes the repository root `node_modules`. The normal Windows/npm
workflow is therefore fully independent from ChatGPT repair state. Older manifest-hash cache entries are left
intact on purpose so another repair copy pinned to an older revision is not broken by an update.

The refresh process stages the entire next vendor first. Existing verified files are reused, missing/changed files
are downloaded, every npm archive is checked against `package-lock.json`, Node/Python archives are hash-checked,
and only then is `vendor/offline` replaced. Old archives are deleted only after the new complete set is valid.
