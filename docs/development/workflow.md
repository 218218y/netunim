# Development and verification

The repository root is the working directory for the commands below. Use Python 3.10 or newer, a Node version admitted by [package.json](../../package.json) (22.13+ on the 22 line, or 24+) and a current Chrome or Edge for browser suites. GitHub verification uses Python 3.14 and Node 24. The PostgreSQL suites require disposable PostgreSQL tooling. The full Supabase stack runs in GitHub Actions.

```powershell
python -m pip install -r tests/requirements.txt
npm ci --ignore-scripts
npm run hooks:install
```

The managed pre-commit hook derives shared assets and service-worker metadata from the staged Git snapshot. It stages generated outputs for the selected changes, which keeps partially staged files meaningful. Rerun the installer if the Python interpreter moves. Check the hook with `npm run hooks:check`.

## Edit and verify

| Change | Focused command |
| --- | --- |
| Canonical shared JavaScript or public assets | `python tools/sync-assets.py`, then `python tools/sync-assets.py --check` |
| Checked contracts | `npm run typecheck` and the related `tests/*typecheck*.test.mjs` files |
| JavaScript behavior | `node --test tests/<suite>.test.mjs` |
| Python contracts or runtime fixture | `python tests/<suite>.py` |
| PDF.js or Office preview assets | `npm run pdfjs:check` or `npm run document-viewers:check` |
| Bundling and public payload | `npm run build`, then `npm run build:check` |
| App action registration and ownership | `node tools/feature-entry-audit.mjs` |

The checked JavaScript implementations and their declaration files are listed in [tsconfig.contracts.json](../../tsconfig.contracts.json). Keep runtime decoding at HTTP, IndexedDB and provider boundaries. Static types complement the behavior and recovery tests.

The [offline dependency bundle](../../vendor/offline/README.md) supports verification on an offline Windows machine. Use the [synthetic lab](test-lab.md) for interruption and restart scenarios.

## Full verification

```powershell
python tests/run_all.py --help
python tests/run_all.py --group models
python tests/run_all.py --keep-going
```

`npm test` and `verify.bat --no-pause` run the normal full local suite. The runner chooses a bounded number of parallel processes, with a separate browser limit and exclusive performance measurements. Use `--jobs 1` for serial diagnosis. Each run writes logs, timing data, JSON and JUnit reports under `.work/verification/`. See `python tests/run_all.py --help` for options.

[The verification plan](../../tests/verification_plan.py) owns the suite inventory for local and GitHub runs. Register a new Python suite in that plan. The Node model runner discovers `tests/*.test.mjs`. [Full verification](../../.github/workflows/verify.yml) runs on push and PR candidates and checks the groups, native Windows contracts and the disposable Supabase stack. The closing **Verification complete** job aggregates the required results. [Security verification](../../.github/workflows/security.yml) runs secret scanning, dependency checks and CodeQL.

For diagnosis, open the failed job and download its verification artifact. Report the exact tested SHA and fixture environment. For the fast deployment scripts, use the [exact-commit push verification](../operations/deployment.md#אימות-וכניסה-לסקריפט).
