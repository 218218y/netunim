These are the actual classic-script-era Service Workers from repository commit
46c4e8d (before the native ESM migration), retained byte-for-byte for upgrade tests.
They are test fixtures only and are never deployed by either site.

The upgrade test uses these workers with a minimal classic-script shell and
synthetic browser data, then serves the current complete site on the same origin.
This exercises cache migration and process restart; it does not claim to exercise
an OS-installed production PWA or historical business/UI code.
