# Production postflight, 2026-10-18

The quality continuation refreshed this complete authenticated read-only check
at **11:09:17 UTC** with the same 41 migrations and 128 functions. The supported
recorder refreshed the source audit and Production receipt; no schema or business
data changed. See [quality closure evidence](QUALITY_CLOSURE_20261018.md).
The earlier capture below is a historical observation.

An authenticated read-only catalog capture of project `bupoidcurcxuypfrjqio`
was taken at **02:46:37 UTC / 05:46:37 Asia/Jerusalem**. The complete postflight
passed against an expected schema derived by replaying the reviewed migration
suffix on the previous authenticated Production baseline in disposable PostgreSQL.
The candidate was an expectation only; the connector capture supplied live evidence.

Verified: all **41 migration identities and SQL statement hashes**, **128 active
functions**, application tables/columns/constraints/indexes, privileges/policies/
triggers/types, and pg_cron with its two active retention jobs and operational settings.
All three Bank migrations, including `20261016140000`, are installed. There was no
unexplained schema drift. No migration, application record or provider was changed.

The supported recorder wrote the source audit, current schema snapshot and
hash-bound [Production receipt](../supabase/production-deployment-receipt.json).
The offline `python tools/supabase_postflight.py --release-gate` now passes with
no pending database release. This is a dated observation; each static upload still
requires the existing fresh live deploy gate when live access is available.

Evidence: [authenticated audit](../supabase/audit/production-postflight-20261018T024637054991Z.json).
Reproduction commands after obtaining a new release-bound connector capture:

```text
python tools/supabase_capture_query.py
python tools/supabase_postflight.py --capture CAPTURE.json --expected EXPECTED.json --record-release
python tools/supabase_postflight.py --release-gate
```

The 2026-10-16 scoped records remain historical observations. They must not trigger
reapplication of the installed temporal migration. Physical weak-Windows recovery,
two physical clients, installed Bridge interruption and live provider/performance
validation remain operator work; this database check cannot certify them.
