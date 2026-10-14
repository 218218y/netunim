# Morning status execution and presentation

## Before-change evidence

Baseline main `1302acc82c91258247795690ea994f2e58153dd3` already decoded
operation evidence and owned accepted issuance/recovery work. Two controller
regressions reproduced late status publication: an allocation completing after
modal replacement marked the replacement's unrelated draft saved, and a delayed
older read overwrote a newer connection result in the same form.

A separate application regression reproduced a shared completion across two
different verified operation IDs in the same account. Only the first operation
entered allocation. These are isolated test failures, not evidence of production
data loss. An additional joined-display regression protects the implementation
from retaining the obsolete publication fence when a current caller joins work.

## Ownership boundary

`morning-status.js` has six ports: lifetime, commands, session, recovery,
application and presentation. It owns the status decision sequence and current
request generation. It has no DOM, raw model, JSON transport, persistence API or
timer implementation. Accepted work and authority belong to the existing Morning
lifetime; the parent customer runtime drains that work through disposal.

Publication requires the current request and captured form. The operation must
also still match before accepted allocation can settle into session flags.
Allocation already in progress can finish durably after visual replacement, but
cannot publish connection state or certify another modal draft. Disposal revokes
authority; it still joins accepted completion rather than discarding work.

Starting official issuance and `runtime.cancelPending` invalidate earlier status
publication. They do not abort accepted requests or original journal submissions.
Recovery wake scheduling remains owned by the existing lifetime.

Application joins now include the operation ID as well as the lifetime's
account/login authority. Different operations cannot share a result. Current
callers for the same operation still share one accepted flight. That flight uses
the current joined display for status/decision presentation; loss of presentation
does not grant or revoke financial write authority. Confirmation queries the
application capability's current pending state.

`morning-status-message.js` is a pure presentation model. An immutable fixture
derived from the baseline status function characterizes 864 configuration,
availability, environment and recovery combinations. Their messages and priority
decisions are preserved. The former inline status workflow is removed from the
controller, while its existing DOM renderer supplies presentation effects.

## Validation and retained scope

Strict checkJs checks the status, message and application bodies. Negative
consumers reject asynchronous presentation permission, textual generation or
completion and arbitrary backend access. Actual body mutations reject fabricated
session completion, a string presentation result and a string pending result.

Existing immutable allocation, issuance, recovery and confirmation policy checks
retain their financial behavior, with explicit normalization only for the new
publication guards and pending-capability adapter. Native browser tests exercise
dirty modal replacement during accepted allocation, out-of-order status reads
and a held status read across real confirmation/reservation/issuance. They check
exact original Main events, retained notes, Shared isolation, no duplicate create
and preservation of the unrelated draft guard. Provider transport is synthetic;
the modal and IndexedDB effects are native. Full Git CI remains the merge gate.

No Storage protocol, SQL, provider request, retry/fallback policy, historical
recovery reader or backup format changes. Form rendering/editor responsibilities,
broader issuance/customer composition and remaining search/metadata payload
contracts are still separate work. This does not certify live provider sessions
or physical two-computer operation.
