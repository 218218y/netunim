# NETUNIM offline verification vendor

This directory is intentionally populated by `npm run offline:download` rather than by `npm install`.
It is the minimal Linux x86_64 + glibc toolchain used by the ChatGPT repair environment:

- the repository-pinned Node 24 runtime;
- the exact npm development dependency closure from `package-lock.json` (ESLint + Acorn tooling);
- the pinned pure-Python `websocket-client` wheel used by the Chromium DevTools harness.

Chrome/Chromium itself is **not** vendored: the ChatGPT environment supplies it as a system browser and the
runtime harness deliberately discovers it from the host. Wrangler is also excluded because it is a deployment-only
CLI, not part of the verification dependency closure.

Maintenance commands (run from repository root):

```text
npm run offline:download   download/rebuild the complete vendor in one command
npm run offline:check      verify lockfile/hash integrity without installing
npm run offline:install    install only from local archives; network is not used
npm run test:offline       install as needed and run the complete verification gate
npm run lint:offline       run ESLint through the vendored Node/toolchain
npm run offline:update     update allowed versions, redownload transactionally, then remove superseded archives
npm run offline:clean      remove generated installations while keeping this vendor
```

`offline:download` and `offline:update` may be executed on Windows before uploading the repository to ChatGPT.
`offline:install`, `test:offline` and `lint:offline` intentionally fail outside Linux x86_64/glibc, because the
vendor is a repair-environment artifact rather than a production/runtime dependency set. The installer never
overwrites an ordinary npm-created `node_modules`; it only replaces/removes a `node_modules` tree carrying its own
offline-management marker.

The refresh process stages the entire next vendor first. Existing verified files are reused, missing/changed files
are downloaded, every npm archive is checked against `package-lock.json`, Node/Python archives are hash-checked,
and only then is `vendor/offline` replaced. Old archives are deleted only after the new complete set is valid.
