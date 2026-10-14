# Morning modal ownership and presentation

## Reproduced boundaries

Baseline main `57bc27e70ef71c4a20f6d035abf47e6e8ac95f45` retained a
recovery-only decision surface on account invalidation and disposal. Two further
controller regressions accepted choice writes after modal replacement or close.
A held confirmation also marked an unrelated replacement draft saved after its
approved financial work completed. These isolated failures establish the
ownership gaps; they do not establish production data loss.

## Mounted surface ownership

`morning-modal-session.js` has four ports: read authority, account observation,
native surface identity/visibility and synchronous presentation. It owns the
captured assertion, generation, mounted element and confirmation signal for both
issuance forms and recovery-only decisions. The operation lifetime still owns
accepted requests, reconciliation, allocation and drain.

Form actions require the exact mounted native element, open modal and captured
account assertion. Field queries use that element's modal rather than global
matching IDs. Account invalidation/disposal clears only the retained owned
surface, including closed private DOM; another feature's replacement survives.
Reopening cancels the former unaccepted confirmation. Disposal is final and
idempotent and removes account observation synchronously.

Choice persistence requires an active decision display. An already accepted
confirmation can still finish its original approved allocation durably after
visual replacement, while its completion cannot certify the replacement draft.
Visual cleanup preserves the exact historical recovery context and Main/Shared
journals. No Storage protocol, recovery format or provider request changes.

Strict implementation/negative consumers cover synchronous authority, visibility,
rendering and cleanup, mounted identity, numeric generation and cancellation.
Controller regressions and the existing native privacy suite cover recovery-only
decisions, account/logout/cross-tab changes and retained durable evidence.
