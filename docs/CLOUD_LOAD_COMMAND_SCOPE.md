# Explicit Kupa cloud load and discard retain their initiating scope

After fencing regular polling, the explicit load/discard command was reviewed
separately. It could borrow a replacement account's current owner check after
waiting for its original head, remote read or reset. Fifteen held replacements
(account, storage epoch, login; normal load and discard) fail against `301ab91f`.
These are actual remote-adoption command bodies, not a type-only consumer.

The command now captures CloudWriteScope on entry, checks head identity after
each journal read, and checks authority after HTTP/reset/save waits. Its final
adoption receives the same current-scope callback through the actual durable
checkpoint and publication path. A late old command cannot update the new
session's revision, replace its model, write a conflict on it or begin a reset
for its owner. Existing explicit discard semantics and storage/cloud formats
remain unchanged for an unchanged scope.

All fifteen replacements and both unchanged-scope controls pass. Existing Kupa
cloud/hydration tests retain their explicit authoritative fake head and account
scope. The new policy digest binds only this reviewed authority change; the
historical policy fixture remains frozen. No source/module/timing ceiling is
raised for this stage. Static compilation and canonical asset synchronization
remain required along with CI.

The discard command still uses the existing visibility-before-reset sequence
while its original scope is current. This change does not claim to redesign
discard transactionality or change when the user-approved discard occurs.
