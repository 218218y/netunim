# Deferred document viewers and selection ownership

The measured startup audit identified optional document preview modules in both
eager ESM graphs. `domains/documents/preview-modules.js`, generated from
`shared/document-search`, now owns their literal dynamic imports. Search binding,
business search, result lists, native preview and startup recovery remain eager.
Each PDF/DOCX/text/spreadsheet constructor is loaded only on use; PDF/DOCX vendor
preparation still runs in parallel with the selected file request.

The new boundary requires the captured selection's `current()` proof. It checks
before importing and again after the module promise resolves. Close, disposal,
query/result replacement and account invalidation already retire the selection
through the search owner's abort/sequence fence. Those same checks now guard the
new asynchronous import boundary. A missing proof rejects before any resources.

Each actual viewer receives a private mount inside the current preview body.
That is necessary beyond lazy loading: the previous constructors received the
shared live preview body. A text/DOCX/spreadsheet viewer finishing after selection
replacement could be destroyed as stale and clear the newer preview with its
`host.innerHTML=''`. The private mount confines late rendering and destruction to
the old selection. Completion after retirement destroys that viewer; repeated
destruction joins the same cleanup promise and removes only its own mount.

The owner shares application-module load promises and discards rejected ones.
Native ESM retains its own browser cache semantics; a browser-cached failed module
fetch can still require reload. Existing PDF fallback and document error/retry
presentation remain in the shell. No cache-busting or computed import URLs are
introduced. Third-party runtime loading policy is unchanged.

## Verification

- Constructor/held-import/held-constructor/error/cleanup tests cover all four
  formats. Implementation mutations demonstrate why the post-import scope check
  and private host are required. Every real shell call is checked for its proof.
- Native uninstrumented Chromium tests show none of the four viewers requested at
  startup, all first-party viewers present in the installed offline shell, first
  text preview/search working offline, and no vendor request during those imports.
- The native account-privacy regression still clears completed former-account
  previews without changing Main/Shared journals or accumulating browser listeners.
- Existing preview/PDF policies, native startup, offline/PWA and deployment suites
  remain in the full branch gate.

Before this slice the eager graph contained 303 Kupa and 401 Orders first-party
modules. Afterward it contains 298 and 396: five fewer modules and approximately
68 KB less normalized first-party source per startup. Source/module ceilings are
reduced accordingly. This is a deterministic graph reduction; local timings are
variable and do not establish a reliable end-to-end speedup. The Service Worker
continues precaching these first-party files, so total installed bytes do not
decrease by the deferred amount.
