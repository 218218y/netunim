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
