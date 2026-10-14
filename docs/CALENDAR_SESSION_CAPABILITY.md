# Calendar connection and synchronization ownership

The Orders Calendar display/editor previously also owned remembered connection
intent, OAuth return handling, Google account verification, delivery/read flights,
queue confirmation, retry wakeups and browser polling. At `f2824668` its controller
was 55,625 bytes with 94 direct function declarations and 19 inputs. It now has
81 direct declarations and 16 inputs; rendering and editing remain separate work.

## Boundaries

| Owner | Responsibility |
| --- | --- |
| `calendar/connection.js` | A single private runtime composition; display callers can capture authority and read credential/configuration availability without accessing Google transport or connection preferences. |
| `calendar/session-runtime.js` | Nine explicit ports for connection intent, account verification, sync/reconnect flights, synchronous queue publication and browser wakeups; owns accepted session commands and joins old flights after replacement or disposal. |
| `platform/calendar-oauth-return.js` | Removes one-time result parameters and constructs the return URL. |
| `domains/calendar/controller.js` | Scoped display/editor lifetime, local event commands, committed-display observation, navigation and presentation. |

The nine ports are not nine scalar dependencies: the display projection has
twelve methods. It deliberately reads navigation/range state and synchronously
publishes an accepted snapshot; the runtime does not inspect the DOM. Existing
Calendar journal, API and storage policies are unchanged.

## Reproduced close races

Before the fix, both regressions failed against the real `createCalendarAuth`:

1. A held authorization start could navigate to Google after Calendar disposal.
2. A held disconnect could write connection preferences and show success after
   disposal, even though its accepted request was correctly retained by drain.

Authorization start now combines the display checkpoint with its newly captured
credential scope before dispatch, response acceptance and redirect. Disconnect
checks the display checkpoint before preference/UI publication. This checkpoint
is independent of the credential epoch that successful disconnect intentionally
revokes. Closed commands reject further work while accepted requests still drain.

## Evidence and limits

- `calendar_presentation_authority.test.mjs` retains the two failing-before cases.
- `runtime_calendar_auth_disposal.py` exercises production composition, real
  browser/IndexedDB, both held requests and exact retained Main/Shared/event stores.
- Immutable policies from `f2824668` protect thirteen event/editor algorithms and
  the full sync sequence, expanding only explicit projection/port substitutions.
  A mutation confirms that removing patch attribution fails this evidence.
- Strict checkJs covers the actual session/connection/OAuth owners. Negative
  consumers reject asynchronous queue predicates, textual confirmations, malformed
  account identities and missing display cancellation authority. An implementation
  mutation makes textual sync confirmation fail compilation.
- Existing native suites retain concurrent append, cross-tab confirmation,
  lost delivery, account privacy, old-flight drain and reconnect coverage. Full
  PostgreSQL/browser/Windows verification runs on the feature branch in GitHub.

This is a session orchestration slice. Editor commands, display models/renderers,
complete Google response decoding, Customers/Morning, Finance/Bank providers and
Document Bridge decomposition remain in the architecture inventory. No claim of
whole-application typing or physical two-computer/provider verification follows.
