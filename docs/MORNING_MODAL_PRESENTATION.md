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

## Readonly presentation

`morning-document-view.js` owns document type labels, form/footer markup, local
allocation warnings, recovery comparison and verified-operation presentation.
Two readonly ports supply text/money formatting and financial comparison. Ready
date, payment and Bank view sections come from their existing owners. No raw
model, DOM, provider, journal, clock or persistence capability enters this view.
The controller retains source selection, payload validation and financial commands.

Before extraction, 207 presentation cases were captured from baseline main:
45 form/type/source/prefill combinations, four existing-progress panels, 144
financial decision combinations, footer/button markup and 12 operation views.
The immutable fixture records source/function hashes and the aggregate output
digest. It covers independent opt-outs, historical missing snapshots, reviewed
and stale saved choices, Bank type restrictions and escaping. Runtime tests read
the fixture directly and require no older Git history. Existing immutable
issuance/allocation/recovery function policies are retained separately.

Strict actual view bodies and negative consumers reject deferred formatting or
comparison, nonboolean allocation flags, textual amounts/generations and provider
commands. An actual-body mutation verifies that deferred form markup is rejected.
Native modal/IndexedDB tests cover closed and detached controls, a held accepted
confirmation, exact original event IDs, preserved notes/Shared journal and an
unrelated dirty draft. Provider transport is synthetic; modal and journal effects
are native. Full Git CI remains the final merge gate.

The first full branch run exposed a consumer boundary missed by focused checks:
history/search PDF reads share the controller action, but belong to the separate
browser/media display. Requiring an issuance form incorrectly blocked those
reads after close or before a form had been opened. A focused public-action
regression reproduces that failure. The action now requires current read/lifetime
authority and delegates display ownership to the browser/media owner. Form edits,
preview/issuance and recovery choices still require their mounted form session.

The combined slice reduces `documents.js` from about 51.6 KB to 41.5 KB. Wider
customer composition, form editing/Bank linking and search/metadata response
contracts remain separate work. This is not a claim of full plan completion or
certification of physical two-computer/live provider sessions.
