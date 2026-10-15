# Morning form commands and confirmation read model

The form's synchronous validation now belongs to `morning-command-form.js`,
with four role ports: captured command context, scoped field reads, receipt
capture/totals and money formatting. It returns a typed payload for preview or
issuance and cannot reserve/issue a document, access provider/DOM/storage APIs,
allocate debt or open an approval dialog. The mounted controller captures the
existing authority before calling it and continues to own accepted commands.

`morning-debt-confirmation.js` projects the explicit debt snapshot and selected
allocation policy into the final approval message through formatting and financial
impact ports. It has no write authority and does not choose or apply an allocation.
Both actual implementations and their negative consumers are checked strictly.

All behavior remains deliberate: optional tax/checksum normalization, field
trimming, error order, date/due-date checks, independent document/receipt cents,
the source Bank transfer amount, locked cheque type and partial source limits,
linked tax invoices for receipts, independent local payment/invoice choices,
remaining-debt caps and warnings about previous manual progress. No validation is
relaxed, and no stored, RPC/SQL, issuance/recovery or provider retry policy changes.

## Evidence

- Four original declarations were recorded before editing production and tested
  against that source. Their semantic ASTs still match after expanding only the
  captured context and explicit confirmation arguments. Older immutable issuance,
  media, Bank/payment and recovery policy digests continue to pass.
- Executed old/current comparisons cover 768 form/source/validation scenarios,
  1,008 final confirmation combinations and tax-ID inputs. They compare exact
  payloads, errors, financial warnings and unchanged input records.
- A native production-form fixture rejects six invalid drafts before any provider
  preview and captures two valid previews with the same operation/receipt content.
  It proves no official issuance and no Main/Shared journal mutation. Existing
  native form ownership checks cover all eleven replaced/closed edit commands and
  the 34 scoped control/payload/journal assertions.
- Actual-body mutations reject text money and deferred confirmation. Strict
  consumers reject asynchronous field/format reads and malformed receipt types.

General form parsing and approval presentation now have their own boundaries;
modal orchestration, mounted command lifetime and issuance/recovery coordination
remain visible in the controller and are not declared finished by this extraction.
