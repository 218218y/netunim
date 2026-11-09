# Document Bridge measurement contract

Search and recent `elapsedMs` now measure monotonic time from the search owner's
entry through its final audit write. They include final admission/publication and
PDF work. They do not claim to measure network transfer, browser rendering or
HTTP admission before the search owner starts.

Authenticated HTTP responses expose `Server-Timing` with `bridge` (handler entry
through operation completion, including config/token/body reads) and `operation`
(the selected capability). Preview, binary preview and native preview use this
same boundary. Body serialization, socket transfer and browser rendering are
outside that header's measurement. Browser wall time must be measured separately.

Search `timings` contains monotonic millisecond durations. `everythingMs` includes
configuration/probe, scoped native reads and decoding; `candidateAdmissionMs`
contains live admission of native candidates. Nested `rootValidationMs`,
`pathValidationMs` and `hiddenValidationMs` distinguish roots, canonical targets
and Windows attributes. `pdfPrepareMs` may overlap the Everything read;
`pdfSearchMs` includes supplemental admission. `publicationMs` includes final
publication; `auditMs` includes logging. Durations overlap and must not be summed
as if they partition total time. Each request owns its counters; none are global.

No search expressions, sorting, offset calculation, permission cache, file reads,
hidden-file policy or engine are changed by this instrumentation. No additional
filesystem calls are made for measurement. Synthetic delayed admission/audit and
real ephemeral HTTP are automated. Native Windows drive checks run locally and
in the existing Windows CI job; three installed computers and disconnected Y:
still require operator measurements.
