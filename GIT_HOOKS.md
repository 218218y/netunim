# NETUNIM Git hooks

## Purpose

`tools/sync-assets.py` maintains byte-identical copies of canonical `shared/*.js` modules and the deterministic
service-worker shell/cache key for both applications. CI checks those generated files but deliberately does not
rewrite a pushed commit.

The managed `pre-commit` hook fixes this drift before Git creates the commit. A `pre-push` fixer is not suitable:
changes made then are outside the already-created commit and therefore outside the pushed revision.

## One-time installation

From the repository root, run:

```text
python tools/install-git-hooks.py
```

The installer resolves Git's active hook directory, pins the verified absolute path of the current Python interpreter,
installs only the NETUNIM-managed `pre-commit` hook, normalizes it to LF, and marks it executable. Pinning the interpreter
keeps the hook independent of GitHub Desktop's shell/PATH loading. The installer updates an older managed copy atomically
and refuses to overwrite an unrelated existing hook. Check the installation without changing anything with:

```text
python tools/install-git-hooks.py --check
```

The equivalent npm commands are `npm run hooks:install` and `npm run hooks:check`.

Git hooks are local metadata and are not transferred by clone/pull, so each new clone needs the one-time install.

## GitHub Desktop

GitHub Desktop 3.6+ runs commit hooks and shows their output. The NETUNIM hook does not depend on **Load Git hook
environment variables from shell**, because its installer records the absolute Python 3.10+ interpreter path. That
option may remain enabled for other hooks. If Python is moved or reinstalled, rerun the hook installer once.

The hook synchronizes from the Git index—the exact snapshot selected for the commit—not blindly from every modified
working-tree file. Generated outputs for selected asset changes are added to the same commit. Unchecked or partially
staged source changes stay outside it; their corresponding working-tree outputs remain unstaged for a later commit.

The hook may be bypassed in GitHub Desktop, but CI still runs the read-only `python tools/sync-assets.py --check`
contract. Bypass is intended only for diagnosing a local hook/Python problem.

## Commands

```text
python tools/sync-assets.py           # repair the complete working tree
python tools/sync-assets.py --check   # read-only CI/verification contract
python tools/sync-assets.py --staged  # index-aware mode used by the hook
```
