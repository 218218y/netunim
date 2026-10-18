# Captured workbook storage commands

The actual independent workbook store is now strict checked, including its
transaction body, connection retry and emergency-journal methods. Raw document
and historical recovery reads return unknown data: workbook/model validation
remains with the existing sync owner, not with a second storage authority.

Commit captures the complete structured-clone payload before opening/awaiting
IndexedDB. Journal captures and checks cell patches before opening/awaiting it.
The previous implementation retained live caller references across that wait;
mutating them changed the accepted write. Both original races are reproduced by
real-body mutations and rejected by the captured implementation. Native Chromium
tests exercise the same mutations through the actual database in both apps.

Before merging draft rows, the store validates known row/column/value/generation
fields. Unknown existing entries cause a visible failure instead of being silently
replaced. Historical optional timestamp/generation fields remain optional, raw
recovery data stays available, and the database format/version/keys do not change.

Emergency writes report false when storage is absent, quota is exhausted, the
bounded payload is too large or input is invalid. They retain the previous buffer
on failure. Empty-buffer cleanup remains harmless. A missing emergency port can no
longer claim a durable draft and bypass the sync owner's unload protection.

Negative consumers cover raw unknown reads, namespace/cell/receipt types and
asynchronous recovery reads. A compiler mutation rejects a fabricated successful
status string inside the actual commit transaction. Existing account-switch,
lost-ACK, native abort, quota and reload tests remain required. No eager module or
startup/source budget is added for this boundary.
