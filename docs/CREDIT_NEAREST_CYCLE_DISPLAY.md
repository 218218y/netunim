# Nearest credit cycles and full monthly detail

## Evidence

The user-supplied change `cad2ae2f` distinguishes the nearest eligible open
cycle for each card from the full monthly statement. Its CI failed at two
independent gates:

- `module_contracts.py`: Orders `domains/finance/view.js` grew to 60,125
  normalized UTF-8 bytes, above the unchanged 60,000-byte responsibility budget.
- `runtime_financial.py`: the native credit-detail fixture expected October to
  be absent from the month menu. With no bank settlement evidence, its nearest
  cycles are September, so October must remain accessible. This assertion also
  failed locally before the repair.

There is no evidence of journal loss or a failed financial commit in these
failures. This repair does not change finance reconciliation, settlement expiry,
ACK, SQL, persisted formats, provider scanning or retry policy.

## Presentation ownership

`shared/credit-detail-sections.js` owns the common table-body presentation:
foreign rows, uncertain rows, and known cycle headings. Both applications use
the generated copies from `sync-assets.py`. Applications supply four explicit
presentation ports: column count, row renderer, date formatter and HTML escaper.
Card ordering, record identity, filtering, pagination and business selection
remain with their existing owners. A shifted debit within the same nominal cycle
uses one heading; different actual months remain distinguishable.

The duplicate upcoming renderers were removed from both views. Orders now uses
59,005 bytes and Kupa 57,034 bytes; the size gate remains unchanged.

## Display contract

- Nearest is a per-card selection. Its cards can belong to different months.
  An elapsed, eligible unverified cycle is not replaced merely because its date
  passed. Existing reconciliation/expiry warnings still govern eligibility;
  this is not an unlimited hold or a new offline outbox.
- Full monthly detail includes that month's records independently of the nearest
  selection. These views can overlap and their totals must not be added together.
- A month is omitted from the month menu only if all its visible card-cycles
  are already represented by the nearest selection. A partial overlap keeps
  the full month accessible; a selected month stays available.
- Confirmed settlement advances the affected card only. Paid immediate foreign
  debits remain in statement history without being counted again as upcoming.
- Rendering and switching views must not modify issuer records or identifiers.

## Verification and rollback

The native `credit_detail_cases` drill runs through both production views and
their actions. It covers unverified September cycles, a single confirmed debit
with September/October mixed headings, full October detail, confirmation of
the remaining cards, unchanged issuer records, date-range boundaries, custom
card order, scrolling and narrow-screen controls. Its first scenario uses no
bank settlement evidence; the independent partial-settlement scenario uses a
fresh snapshot inside the existing settlement hold window.

Focused Node tests also cover section ordering, escaping, nominal-cycle headings
and all existing billing/reconciliation behavior. Both failing CI gates are
rerun in the canonical full branch verification before merge.

Rollback uses the previous compatible site assets. No storage migration, reset,
journal deletion, provider rescan or production-data experiment is required.
