# Backup browser resources and account scope

Both backup facades compose `shared/backup-browser-resources.js` with
`backup-file-authority.js`. The native owner captures storage identity and login
epoch before opening an input or accepting a supplied file. Restores also retain
the local generation and primary-writer check. Local input cancellation removes
both listeners and the element. Invalidation/disposal fences late read results
and diagnostics while accepted file reading and restore cleanup remain drained.

The Orders preview keeps the captured proof after the picker has settled and
requires the exact reviewed UI object for apply. Kupa's import button now enters
the same owned picker before selection; the old static input, FileReader callback
and change action were retired. Existing JSON validation, Orders 50 MB limit and
two-journal restore/import algorithms remain in their current owners. A restore
may advance its own generation; the native owner does not misclassify that
successful commit as a stale pre-restore view.

Restore confirmation receives the native operation's abort signal and checks its
captured authority at the existing restore checkpoints. The existing backup
cutover port now cancels/drains browser work and automatic backup work together.
Account observation invalidates the open picker, the owned preview and retained
cloud-point cache. Disposal removes that subscription without closing another
component's modal.

Blob URLs, anchors and cleanup timers have one owner. Cleanup retains the exact
created URL even if the DOM href changes, and runs on timeout, failure,
invalidation or disposal. The two unowned `ui/backup-download.js` modules have no
remaining consumers and were removed; offline shell generation removes them too.

Cloud backup list, pagination, point read, preview, download and restore now
retain the account that requested the data. A late success/error cannot write a
new account's cache, modal or diagnostics. Point restoration also requires the
actual privately retained entry, a current account proof, and fresh mutation
admission. Their accepted remote work and restore confirmation join the same
drain. This closes a neighboring account-publication gap found while binding
native downloads.

Evidence includes canonical and generated-owner tests, malformed/negative static
consumers, eight implementation mutants, primitive identity capture, a successful
post-picker preview/restore, canceled/failed/oversized input, late read/error
suppression, accepted-work drain and 100 download resource lifetimes. Twenty
catalog tests cover account replacement during results/errors, stale/fabricated
targets and a valid generation-advancing restore. Native browser scenarios use
actual app composition, input/listener/Blob APIs and both V2 journals for canceled
reading, account replacement, held confirmation, successful import and 50 export
cycles per app. They use synthetic files and disposable browser profiles.
