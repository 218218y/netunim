# Morning document media ownership

Draft previews and official documents now publish through one five-port owner,
`domains/customers/morning-document-media.js`. The issuance controller and
document browser no longer own separate Blob URLs or preview counters. The owner
accepts read-only requests, captures a modal surface and scopes both request kinds
to one publication generation. It cannot issue a document or allocate debt.

## Reproduced failures

Both `morning_preview_ownership.test.mjs` cases failed on `4d97e2a0`:

- A held draft response replaced the official PDF already displayed in the same
  issuance iframe, including the note identifying it as an official document.
- A held standalone PDF response opened a Morning viewer over a newer modal
  owned by another capability.

The shared generation fences older draft/official responses. Presentation captures
the modal's child identity, open state and existing Morning surface before the
request. A response cannot publish after close or replacement; opening its own
standalone viewer renews that captured identity synchronously.

## Resource and contract boundaries

`platform/morning-media-presentation.js` owns DOM selection, official/draft copy
and standalone viewer construction. `platform/morning-media-effects.js` owns Blob
URLs and a lazy native MutationObserver. Modal close/replacement releases the
owned URL and observer. Cleanup removes an iframe source only when it still equals
that owner's URL. Iframe load keeps the URL alive for Chrome's PDF Download action.

The media capability exposes `cancelPending`, `drain`, `dispose` and `isPending`.
Cancellation fences publication; drain still joins every accepted provider read.
The browser also tracks complete accepted search/details/download/metadata/view
commands, including asynchronous metadata persistence, and exposes its runtime.
Its existing download-anchor/timer cleanup remains owned by account/disposal
invalidation. This does not establish drain ownership for all customer issuance
and recovery jobs; those remain separate work.

External draft and operation responses enter as `unknown`. Draft decoding requires
textual base64 and a PDF signature. Verified-operation viewing requires the created
state, a parseable textual verification time and a textual document identity.
Historical non-UUID document IDs remain supported. These display decoders do not
authorize debt allocation or finance publication.

## Evidence

- Two failing-before regressions now pass through both real controllers and the
  real Morning request adapter.
- Owner tests cover cancellation, disposal, replacement, accepted-request drain,
  source lifetime, newer-source preservation and malformed external payloads.
- Strict actual bodies and negative consumers reject asynchronous assertions or
  current predicates, JSON substituted for a Blob and fabricated identities/drain.
- Immutable policy fingerprints from `4d97e2a0` preserve twelve issuance, debt,
  recovery, metadata and download functions without normalizing their algorithms.
- `runtime_morning_media_ownership.py` runs actual forms, iframe sources, native
  modal observation, retained provider work and exact Main/Shared/recovery stores.
  The new suite belongs to the canonical full GitHub gate, alongside the existing
  Morning privacy, financial recovery, PostgreSQL and Windows suites.

The broader Morning controller still owns issuance/recovery coordination and form
presentation. This slice closes concrete shared-viewer ownership faults; it does
not claim that the full Customers/Morning decomposition is finished.
