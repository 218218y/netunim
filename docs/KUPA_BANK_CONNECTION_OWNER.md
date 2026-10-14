# Kupa local Bank connection ownership

Eight actual-controller tests failed before this extraction: former-device
status success/failure, diagnostic download and configure/select/delete
publication; an invented v74 credential acknowledgement; and overlapping vault
mutations. The corrected implementation delegates them to a private strict owner
with six required ports: pairing, transport, presentation, downloads, clock and
protocol. This preserves the existing local request payloads, password whitespace,
account leading zeroes and explicit typed-token credential bootstrap.

Status flights and the existing 15-second success/failure cache are scoped by
observed pairing generation and command revision. A replacement device can start
its own read while accepted former-device work drains. Vault writes supersede
status reads started before or during the mutation. They cannot invent version
evidence. The minimum version remains 74, independently checked again before the
financial provider runs. Unknown status is not proof of an installed version.

The Bank controller retains financial refresh/lease/durability authority and
feedback. Passive availability cannot erase an unverified financial publication
warning. A changed pairing or accepted local connection intent retires former
feedback; invalid input does not. Account authority still controls lease cleanup
independently of device publication guards. The controller has 18 collaborators;
its download effect port and embedded local connection implementation are retired.
If a financial operation stops on pairing change, it publishes the canonical
local explanation after retiring former-device fields. The existing native money
gate reproduced a missing explanation during CI; a model regression and focused
native reproduction verify both visibility and suppression of private errors.

Native forms own their rendered identity, observed pairing and submit listeners.
Replacing a form releases its former listeners. Explicit pairing can retain the
existing draft; a form rendered for a different device cannot submit credentials.
Connection publication updates the existing Bridge panel without replacing the
credential form. Capability disposal closes commands/listeners, suppresses late
notifications/downloads and joins all accepted Bridge work through drain.

Regression coverage includes the eight before-change cases, private-owner cache,
revision, A-to-B-to-A, unknown-version/bootstrap and disposal cases, strict negative
consumers and an actual-body mutation. Ten registered native browser scenarios
cover status/error, diagnostic, configure/error, delete, select, disposal, form
replacement and stale submission. They assert exact Main/Shared IDB records,
unchanged business state and note recovery after reload. Immutable policy fixtures
retain archive/snapshot algorithms and the moved account projection; only the
explicit delegated UI readout union is normalized for the historical hash.

This does not type-check complete Bank provider payloads or finish financial
workflow decomposition. Deployed migrations, storage formats, RPCs, providers,
retry/fallback policy and the Bridge installer protocol are unchanged. Historical
persisted readers remain active migration boundaries; running only new site code
does not prove old durable records or backups have disappeared.
