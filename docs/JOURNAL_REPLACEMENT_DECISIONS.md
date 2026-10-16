# Remaining replacement and flight decisions

Five additional decision implementations in `storage-journal-authority.js` are
strict checked: same-epoch checkpoint replacement, local-only replacement,
flight admission, rejected-flight rebase and local epoch reset. They are invoked
inside the existing IndexedDB read/write transaction before its first write (and
before local-only journal retirement). This is selective authority checking, not
a rewrite of the transaction engine or a claim of a newly discovered data bug.

Input capture, persisted-head decoding, writer fencing, expected-head comparisons,
physical journal-key validation and transaction-completion receipts retain their
existing owners. A rejected flight keeps the prior ACK sequence and requires a
newer cloud revision and the exact current local checkpoint. Local replacement
cannot retire journal while any cloud base, flight or control exists.

The decision suite now disables eleven actual guard conditions and demonstrates
the authority violation that each original implementation prevents. Typed negative
consumers cover the new arguments. Native `runtime_journal_authority.py` exercises
36 rejected transitions across Orders, Kupa and Shared Checks, compares the full
stored head/journal before and after, and retains the request-success followed by
transaction-abort regression. Existing recovery and lifecycle suites remain in CI.

Startup observation after this change: Kupa 297 eager modules / 1,734,581 source
bytes; Orders 397 / 2,353,962. Existing byte/module ceilings remain unchanged.
