# Checkpoint replacement and journal retirement authority

A native reproduction showed that `resetState` accepted a checksum-valid
checkpoint with array `state`, then deleted the previous journal. A checksum
proves integrity of JSON bytes; it does not prove a valid replacement checkpoint.
Other checkpoint writers shared the same generic-envelope-only consumer pattern.

All eleven checkpoint writers now capture a detached, decoded checkpoint command
before their first database await. This includes install/initialization, compaction,
local and cloud replacement, ACK/rebase, recovery, adoption and epoch resets.
Optional historical metadata remains optional/null; no business schema or repaired
defaults are invented. Current owner/epoch/sequence and cloud preconditions still
run inside the original transactions. Invalid commands cannot replace state or
clear flights, controls or journal rows.

Full-head write transactions read journal values and physical keys in the same
transaction. A checked deletion-plan reader proves each sealed row's owner, epoch
and numeric sequence agree with that exact physical tuple. Deletion uses the
proven tuple rather than manufacturing keys from mutable payload fields.
Malformed, corrupt or mismatched rows abort the transaction and remain retained.
The append hot path and readonly load retain their previous request counts.
This reader proves deletion scope; application operation/business-schema validation
remains with the existing replay and mutation owners.

Evidence includes negative checked consumers, malformed replacement matrices,
detachment, checksum/physical-key mutations and a mutation removing the actual
key comparison. Native IndexedDB in both apps covers all eleven replacement
consumers, five retirement routes, complete retained-store/key comparisons and
successful import/reset with caller mutation while the transaction is pending.
Eager module and source budgets remain unchanged.

Remaining journal/runtime contract work is recorded only in the current backlog;
this is not a claim of complete strict checking for every business IDB body.
