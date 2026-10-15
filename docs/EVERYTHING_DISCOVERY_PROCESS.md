# Everything discovery and process boundaries

Executable discovery now belongs to a strict four-port owner: known locations,
file existence, registry/PATH commands and Windows executable path projection.
Only this owner caches ES's selected path. Environment and installed-location
policy stays in the native adapter. Original/current tests follow every ordered
candidate and compare file checks, registry commands, PATH fallbacks, cache and
errors on Windows and non-Windows paths. Default strings are checked before host
path normalization, including the historical spelling.

A strict process owner tracks every accepted ES, generic discovery and application
launch command. It preserves ES's UTF-8/cwd/16-MiB options, timeout, abort error
identity, stdout/stderr and exit-code normalization. All such commands now join
server shutdown, including direct status/inventory/preview ES reads outside the
readiness session. Disposal during file/registry discovery suppresses further
lookup/cache publication and joins the accepted command.

The native adapter now acknowledges `spawn` or rejects its `error` event before
the session continues readiness. A native isolated worker proves that the original
unhandled missing-executable error terminated its process. The current adapter
returns ENOENT as an ordinary failed operation and remains usable. Readiness does
not retry or update config after launch failure. Disposal joins an accepted launch
acknowledgement; a successfully launched detached Everything application retains
its own lifetime and is not killed when the Bridge retires.

Native tests cover Unicode/cwd, >1-MiB ES output, timeout, abort and missing-app
launch. Executed before/current transport policies compare process arguments,
defaults and normalized errors. The actual server composition/shutdown is exercised
with held direct ES work, alongside the existing native children, HTTP/search,
inventory, maintenance and installer dependency-closure suites. Strict bodies,
negative consumers and real-body mutations reject malformed output, unacknowledged
launch and incomplete drain. No wire, search, retry/fallback or persisted format
changes; live Registry/Everything/Preview Handler certification remains separate.
