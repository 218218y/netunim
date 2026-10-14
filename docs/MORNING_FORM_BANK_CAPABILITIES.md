# Morning form editing and Bank links

## Scoped editing

Baseline main `79e104c8720c1c54d3aac51be3d472bd1f62fa73` reproduced three
controller/editor gaps: unmounted payment actions changed another surface's card
suffix, Bank selection without a form restricted another surface's document type,
and global payment reads captured receipt rows outside the owned form.

All public synchronous form/link commands now require the existing Morning modal
session. Payment reads and synchronization query the owned rows host. Bank debt
and transaction picker helpers receive the current form root explicitly, including
ID lookup, selection, type restriction and focus behavior. Closed or replaced
forms reject edit commands before their effects. Independent history/search PDF
reads continue to use their own browser/media display authority.

An immutable baseline fixture preserves twelve payment input/render/validation
functions, normalizing only the new scoped row lookup and native template line
endings. The existing issuance/allocation policies and 207 view cases remain
independently protected. A native browser fixture covers active external controls,
exact owned preview payloads, Bank linking/restoration, all eleven closed/replaced
edit commands, unrelated draft guards and unchanged Main/Shared/recovery evidence.

This slice does not change Storage protocol, provider requests, financial caps,
receipt locks, historical recovery readers or document issuance/retry policy.

## Bank link capability

`morning-bank-transaction-link.js` now has five ports instead of the original
fifteen: session, catalog, eligibility/prefill policy, form commands and
presentation. It owns source intent, the original snapshot, catalog results and
request sequence. Unknown catalog input is checked before ID lookup; malformed
archive identities never enter eligibility or form mutation. The existing Bank
eligibility and prefill functions retain their financial rules.

`morning-bank-link-form.js` is a strict four-port adapter for source replacement,
scoped fields, payments and document controls. It captures/restores the original
form, limits linked sources to receipt-capable types and updates only supplied
controls. Private `morning-bank-links.js` composes these owners with the existing
Bank catalog and picker view. The customer-document controller consumes this
capability rather than wiring its transport, snapshot, radio and picker effects.

Before the change, a held catalog failure published diagnostic details after
form/account presentation authority was revoked. Current request and session
checks now gate both success and error publication; current failures remain
visible. Later requests/reset supersede display publication without aborting
accepted reads. The enclosing Morning lifetime owns accepted refresh drain; its
native regression confirms cancellation cannot finish drain before a held read.

An immutable fixture derived from baseline main characterizes 576 transfer,
multi-cheque, rejected source, original debt/standalone/Bank, document type,
busy/blocked and restore combinations. Existing linked-document rejection,
customer identity, reference/description, payment locks and original field values
remain intact. Strict bodies, negative consumers and implementation mutations
reject asynchronous permission/effects, textual refresh results and fabricated
source identities. The native fixture now has 34 control/payload/drain/journal
assertions. Full Git CI remains the merge gate.

Broader Customers composition, general payload/form validation, remaining
search/metadata contracts and the other architecture stages remain open. This
slice does not certify live Bank sessions or physical two-computer workflows.
