# Bank Bridge 79 — narrowly scoped dependency repair

The locked audit before this change reported three moderate package findings:
`camoufox-js` through `glob`, `glob` itself and `minimatch`. These represent two
underlying advisories, not three independent exploit paths. Root verification
dependencies separately reported three moderate package findings for the same
minimatch advisory through ESLint/config-array. These are fixed too with a
root-only minimatch 11.0.5 override; ESLint remains on its existing version.

The reviewed [glob advisory](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4)
describes traversal continuing after cancellation and identifies 14.0.2 as fixed.
The [minimatch advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249)
describes pattern amplification and identifies 11.0.1 as the first patched
version. Camoufox 0.13.0 declares glob ^13.0.0. Inspection of its installed dist
found no imports/calls to glob; no HTTP query-to-glob flow was found in the Bridge.
That limits the demonstrated exploitability, but retaining a vulnerable unused
dependency is unnecessary if a compatible patched dependency can be locked.

Override only Camoufox's glob to 14.0.2 and its minimatch to 11.0.5; keep Camoufox,
scraper, Puppeteer and local credit adapter versions unchanged. The root override is also intentionally validated with the actual compiler and
ESLint across both sites/shared sources. Both patched
packages support the installed Node release. This is an intentional transitive
major override, not an npm audit force downgrade of Camoufox. Locked installs
disable lifecycle scripts as before. The installer now verifies Bridge 79, making
the installed dependency release distinguishable from 78. Reinstall explicitly;
Git updates do not replace an existing installed node_modules directory.

The explicit security CI probe imports the actual locked Camoufox package,
verifies resolved versions, checks synchronous/asynchronous glob over a synthetic
Unicode tree and aborts on the first filesystem read. It proves that no child
directory read continues after cancellation. The existing scraper/Puppeteer
probe launches isolated Chromium and blocks provider navigation. Existing native
bank/credit/profile tests remain in full CI. This does not claim a successful
live credit-provider login or install a Camoufox browser in the owner's profile.

After the lock update, both local npm audits report zero vulnerabilities at the
moderate threshold (November 9, 2026); this is a registry snapshot, not a permanent
absence of vulnerabilities. Keep high/critical audit, secret and digest-bound
CodeQL gates; no scanner exception or suppression was added. Engineering owner:
Bridge maintainer; review the override with each Camoufox upgrade and by December
9, 2026. Remove it only when upstream's declared dependency resolves to a fixed
version and the same compatibility/cancellation probes pass.

Rollback to the prior pinned installer only for a reproduced compatibility fault,
preserving vault, profiles and sync bytes. That restores the documented moderate
dependency exposure and must be a visible time-limited decision, not an implicit
audit suppression. Stage on one computer and exercise normal bank/credit refresh
before updating the other two; no real account is used by this automated probe.
