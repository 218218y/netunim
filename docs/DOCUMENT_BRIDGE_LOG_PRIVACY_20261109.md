# Document Bridge diagnostic retention

Routine search, recent, preview, native preview, open/reveal/delete and PDF
maintenance logs contain event names, counts, durations and recognized error
codes. They omit queries, native expressions, scopes, paths, document text,
native responses and exception messages/stacks. A closed vocabulary at the
file sink also drops unrecognized values from any future caller. Returned file
metadata and user-facing authenticated errors retain their existing contracts.

`bridge.log` is limited to 1 MiB with three backups, a total of at most 4 MiB.
Files expire after seven days measured conservatively from creation/modification,
checked on writes, initialization and hourly while the service is running. A
stopped service removes expired files on its next startup. The first upgraded
write/initialization deletes the known legacy bridge.log and numbered backups;
the policy marker makes that privacy migration repeatable after interruption.
No configuration, token, PDF index or browser state is deleted.

Writes are serialized per process and use the existing PID/token file-lock owner
across runtime and maintenance processes. Contention or I/O failure drops the
diagnostic event; it never blocks a search waiting for another writer. Diagnostic
logs are best effort and are not a durable financial audit journal. Rotation and
retention perform small local metadata operations, not document reads or network
access. There is no mode for persisting raw queries or credentials. The phase
timings plus explicit local doctor/installation diagnostics provide investigation
data; installation reports and old console/installer logs remain operator-owned
and must be reviewed separately before sharing or deleting them.

Tests exercise sensitive synthetic searches through the actual file sink,
unknown errors and multiline strings, legacy cleanup, concurrent writes,
size/count/age limits and preservation of token/config/index bytes. Existing PDF
fallback/publication tests explicitly expect codes instead of raw native errors.
