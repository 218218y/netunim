# Bank Bridge HTTP and financial command boundaries

The former server handler combined authentication, stream/body parsing, route
selection, vault reads, configuration commands, provider entry, diagnostics and
metadata publication. It also required a lexical VM harness to exercise its
private HTTP function independently of production startup.

## Responsibilities

| Module | Public boundary | Required collaborators |
| --- | --- | --- |
| `http-handler.mjs` | Inert listener factory; token/CORS/body/response handling | token, route resolver, public health |
| `http-routes.mjs` | Typed private registry/resolver; no filesystem or provider authority | versions plus service, connections, finance, diagnostics, cheques and shutdown facades |
| `connection-queries.mjs` | Coherent public bank/credit status snapshots | operation owner, vault, metadata readers |
| `finance-commands.mjs` | Bank and credit sync commands; public results after publication | operation owner, bank port, credit port |
| `diagnostic-queries.mjs` | Existing safe local export projections | credit log and diagnostic readers |
| `wire-errors.mjs` | Existing Bank error envelope, also used by bank account projection | no effects |
| `server.mjs` | Concrete composition, startup and existing provider/session implementation | binds the required ports before creating the listener |

HTTP can dispatch capabilities, consume bounded JSON and send JSON/bytes. It
cannot read a vault, launch a provider browser or publish metadata. Financial
commands retain exclusive ownership from before credential/profile reads through
diagnostic/status publication. Their results contain the existing public provider
projection; raw credit diagnostic samples remain local. Connection queries hold
the read owner through both the vault and metadata read and public projection.

No service locator or broad application context was introduced. Factory imports
and collaborator counts have explicit architecture budgets. Direct HTTP/fetch,
filesystem, timer, process and server creation effects are prohibited in routing
and command/query capabilities; required external effects are ports.

## Compatibility and validation

Six native HTTP characterization tests passed before extraction. They protect
public health/preflight, timing-safe private Bearer entry before body/capabilities,
Bank's existing reflected CORS policy, pathname/query handling, credit v2 aliases,
unsupported methods, malformed JSON, exactly 32 KiB UTF8 request bytes, empty
bodies, existing error fields and private 64-hex cheque image IDs/retention/bytes.
The Bank policy deliberately remains distinct from Document Bridge's origin and
exact-request-target policy.

Frozen status and present/absent diagnostic response fixtures were captured from
the actual pre-refactor handler at
`3d32defb1fd35639315ecb60ae65ffdb7b1081ba`, with synthetic inputs. Provider policy
AST fixtures retain the original baseline and now locate selection normalization
in the financial command module; retry/fallback, engine cooldown, identity
recovery, error projection and browser termination algorithm fixtures are not
regenerated. Additional tests cover partial bank/home/history success, credit
partial success vs total failure vs deferral, exclusions, metadata order, raw
sample isolation, vault read failure and client disconnect after acceptance.

Strict checkJs checks the actual routing implementation and negative consumers
for absent capabilities, wrong binary types, invalid reset/diagnostic results and
private vault-shaped import responses. An implementation mutation must fail
compilation when a binary route substitutes a path for bytes. This does not claim
full provider implementation typing. ESLint covers all new implementation files.

Native startup copies the installer's complete module list into a checked
disposable directory, uses the actual server entrypoint and isolates LOCALAPPDATA.
Only the port constant in the private staged copy changes to an ephemeral port;
no installed service is stopped or paired. It verifies authentication, real
status/provider-not-configured responses, cached image bytes and response-before-
shutdown. Windows additionally exercises bank/profile writes through actual HTTP,
DPAPI ciphertext, concurrent accepted profile saves and public status. The native
vault and startup tests run in the required Windows CI job, while full CI retains
PostgreSQL, native browser, recovery, ACK and fault gates.

## Remaining scope

Bank session acquisition/read stages and credit profile orchestration still live
in the composition module and require later ownership reviews. HTTP teardown and
installer replacement semantics are preserved here; this stage does not claim
graceful drainage across process termination or cross-process vault exclusivity.
No schema, deployed migration, encrypted format, provider policy or live login is
changed. Live issuer and physical two-computer rollout remain separate evidence.
