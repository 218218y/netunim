# Isolated staging environment

`netunim-staging` (`nckszremdktftbhimgxc`) is a separate free project in the same
organization as production. Its checked-in browser configuration contains only
a publishable key. No production business data, bank credentials, Morning
credentials, Google credentials or pairing tokens are copied to it.

Cloudflare builds with `CF_PAGES_BRANCH` other than `main` automatically select
staging. They reject `NETUNIM_BUILD_ENV=production`. To build staging explicitly:

```powershell
$env:NETUNIM_BUILD_ENV='staging'
node tools/production-build.mjs
Remove-Item Env:NETUNIM_BUILD_ENV
```

The final config and CSP use only the staging backend. The build manifest records
the environment, and final-payload verification checks the matching security
headers. A production config also returns an empty backend on unknown public
hosts, including immutable and branch Pages preview URLs. The three existing
production hosts and explicit local usage remain supported. A staging build
does not change the source production config or connect to a production Bridge:
the latter separately enforces exact production origins.

For a fresh staging project, use `python tools/staging_bootstrap.py` for a dry run
and add `--apply` to provision it. The authenticated CLI must confirm the exact
project identity. The immutable historical baseline contains 15 default-ACL
statements owned by Supabase's platform `supabase_admin` role; hosted project
roles cannot replay those. The fresh-project adapter excludes exactly those
platform defaults from a temporary copy, preserves all application definitions
and privileges, and applies all later migrations unchanged. Changes to that
allowlist fail closed. It never changes production migration files or history,
copies seeds, updates Vault secrets or targets the production project.

Cloudflare Access still requires the account's Access configuration; the build
guard is not an Access policy. A separately registered staging Google OAuth
client and Morning sandbox credentials are required before enabling those
integrations. Do not reuse production OAuth/Morning secrets. Test users and
Set `GOOGLE_CALENDAR_CLIENT_ID` and `GOOGLE_DRIVE_CLIENT_ID` to their separately
registered staging OAuth clients. The legacy client-ID fallback is restricted to
the exact production Supabase project; other projects fail closed without an ID.
fixtures must remain synthetic. The free project may pause when inactive.

Routine patch/minor Dependabot updates are grouped into one open npm update PR
to bound verification load. Security update scanning remains enabled. Upstream
scraper and browser-engine upgrades still require provider compatibility review;
their availability alone does not authorize replacing a proven production pin.
