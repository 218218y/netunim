# Document Bridge legacy Origin upgrade

## Proven cause

The affected computer retained the six-entry `DEFAULT_ALLOWED_ORIGINS` shipped
before commit `266dc479` (v19): the furniture and Orders Pages domains, their
wildcards, and two development wildcards. Reinstallation preserves `config.json`.
Commit `fdb08303` removed wildcard matching, and the subsequent migration covered
only the three-entry exact defaults and eight-entry Orders + Kupa legacy defaults.
The original six-entry configuration therefore remained unchanged. Its furniture
wildcard no longer authorized `https://orders.bargig-furniture.com`.

The live listener reproduced HTTP 403 `ORIGIN_NOT_ALLOWED` with no CORS grant for
that Origin, matching the supplied browser errors. An incorrect pairing token
would instead produce HTTP 401 with CORS headers after an accepted preflight.

## Correction

The configuration loader also recognizes the complete original six-entry set,
independent of order, and replaces it with the existing five exact production
Origins. Subsets, supersets, duplicate entries and explicit custom restrictions
are preserved. Wildcard previews and development Origins are never re-enabled.
Roots, drive consent and the per-computer pairing token retain their ownership.
No browser protocol/version change is required for this configuration fix.

The installer's existing `--check-running` activation gate now checks actual
OPTIONS preflight and browser-Origin health responses for every usable configured
website, in addition to origin-less service/version health. This uses public
health/preflight only: no token reads, searches, previews or file actions.
A missing CORS grant, forbidden website, missing authorization/content-type
permission or private-network grant fails activation and triggers the existing
installer rollback. A restrictive custom website policy remains authoritative.
These HTTP probes validate server responses; browser-specific local-network
permissions still belong to each browser.

## Validation

`tests/document_origin_upgrade.test.mjs` exercises the real config loader, BOM
legacy file, token file, HTTP handler and installer checker on an ephemeral
loopback port. It covers all five production Origins and the warm, PDF status,
recent, search and native-preview-hide routes from the reported console, plus
unauthorized requests, foreign Origins, persisted reload and a custom policy.
The replacement-command tests reject individual CORS regressions even when the
origin-less health check passes. Existing Origin security and configuration
contracts cover migration boundaries and retained custom restrictions.

On a computer already running the current v48 listener, replacing only the
recognized old `allowedOrigins` value with the five exact production entries
repairs access immediately because configuration is reloaded for each request.
Back up the local file first and preserve every other setting. Other computers
receive the permanent loader/checker correction by running the updated installer.
Never include `bridge-token.txt` in diagnostic output or commits.

The affected computer was recovered using that configuration-only repair, with
a separate backup of its original config. Live probes then returned OPTIONS 204
and Origin-authorized health 200 for all five production sites. Authenticated
warm, PDF maintenance status, recent results, a filename search and PDF preview
metadata returned HTTP 200. The preview-file route returned `application/pdf`
bytes with a valid `%PDF-` signature and the Orders Origin CORS grant. No pairing
secret or business filename/content was included in the evidence output.
