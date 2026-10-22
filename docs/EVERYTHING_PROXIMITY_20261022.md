# Native Everything proximity, 2026-10-22

The review's external-engine concern reproduced on Windows with Everything
1.5.0.1424 and ES 1.1.0.38. A copied executable ran in a uniquely named instance,
with volume indexing disabled, separate configuration/environment and eight
synthetic UTF-8 files. Before content queries the probe verified every indexed
path belonged to that disposable fixture directory. It did not query, configure
or stop the working Everything instance or installed Document Bridge.

For `אב אב אב אב אב אין`, distance 50, `short-valid.txt` contained five prefixes
then the final term; `late-valid.txt` contained 10,000 prefixes then that term.
Both satisfy the canonical contract. Other fixtures had a missing final term,
wrong order or an excessive final gap. The former native proximity regex returned
only the short valid file, with exit code zero and no error. Its wall time was
about 1.98 seconds, including ES startup, with 1.86 seconds of owned-engine CPU.
Simple AND candidates included the long valid file, and the native content
property included its suffix. The actual corrected coordinator returned exactly
both valid files, with `partial:false`, in about 80 ms of coordinator time in this
sample. These are isolated observations, not a general performance percentile.

A second actual native probe found that `whole-words:content:` is not a safe
candidate filter for the canonical Unicode boundary contract: Everything omitted
`alpha beta_`, which the canonical matcher accepts, and accepted `alpha betá`,
whose combining mark the canonical matcher rejects. Proximity candidates now
always use partial literal presence; canonical verification alone decides whole
words. The [boundary observations](evidence/everything-isolated-boundaries-20261022.json)
include underscore, punctuation, joined-word and combining-mark files, and the
actual coordinator returns exactly the canonical whole-word results. Broader
candidates consume the same explicit scan budget; they never become results
without verification.

This is consistent with the maintainer's description of native PCRE recursion
limits and silently missing results in
[Regex file content match limit](https://www.voidtools.com/forum/viewtopic.php?t=16619).
The timing/omission evidence is local; attribution to a particular internal PCRE
limit remains an inference because the executable does not return that reason.

The same actual process owner was tested with a 100 ms AbortSignal and a separate
100 ms timeout against the former regex. ES exited, but the owned Everything
process consumed roughly another 0.6 CPU seconds during the following 800 ms.
Killing the IPC client therefore did not interrupt the current native regex.
The fix removes that multi-gap regex from application proximity queries; it does
not claim that ES cancellation can stop arbitrary native Everything work.
Raw Everything expressions remain the user's external query language.

Read cancellation now travels from the HTTP response's premature `close` through
the search owner and coordinator to the existing ES process port. Only search
and recent-result reads opt into this context; normal request-body completion
does not cancel them. A cancellation check also fences late output from a read
port that ignored its signal, before decoding/publication or another candidate
batch. Accepted file, preview and shutdown commands retain their existing drain;
disconnected shutdown callers still trigger final teardown. Native process
timeouts now report `ES_TIMEOUT`, rather than the erroneous `ES_EXIT_0` caused by
converting execFile's `code:null` to a number. Actual HTTP disconnect, late-read,
native subprocess timeout and accepted-shutdown tests cover these boundaries.

Implementation and bounds are described in
[the canonical search contract](DOCUMENT_TEXT_SEARCH.md). Regression cases cover
the repeated late suffix, wrong order, distance overflow, result pagination after
more than 100 rejected candidates, missing content, candidate-budget exhaustion,
phone compatibility and visible partial results in both real application DOMs.

Reproduce explicitly on Windows, supplying executable paths:

```powershell
python tools/probe-everything-isolated.py --everything-exe 'C:/Program Files/Everything/Everything.exe' --es-exe '<path-to-es.exe>'
```

This opt-in probe copies only those binaries into a fresh `.work` directory.
It never falls back to another IPC instance. Its owned child is stopped in
`finally`; the directory remains for inspection. The JSON includes executable
hashes, exact source base, dirty state and coordinator hash. The checked-in
[observations](evidence/everything-isolated-20261022.json) came from the working
change before commit, so they deliberately report `dirty:true`; branch CI must
separately validate the exact committed revision. No account/provider or physical
two-computer acceptance is implied.

The isolation flags follow the primary
[command-line documentation](https://www.voidtools.com/support/everything/command_line_options/),
[INI settings](https://www.voidtools.com/en-us/support/everything/ini/) and
[named-instance documentation](https://www.voidtools.com/support/everything/multiple_instances/).
