# Orders persistence ownership

The synchronous save API remains: scheduleSave reports emergency durability;
commitSave requires a nonempty typed mutation and confirms exactly the captured
local generation, independent of cloud or newer saves. The journal still validates
operations; these owners do not invent business policy.

- local-commit owns writer/capability admission, revisions, generation, captured
  receipt and outstanding local completion. Secondary mutations request reload
  through the platform; secondary external actions only show the guard.
- save-publication owns the 180 ms debounce, folder follow-up and cloud intent.
  A successful folder copy is independent from IDB commit evidence. Both the
  captured receipt and current journal queue must confirm true before cloud save.
- persistence only constructs these capabilities and preserves the public API.

Cancellation removes only unstarted publication. drain joins accepted local and
started publication work. Disposal prevents new writes and suppresses late local
status while accepted commits continue. Current folder/cloud protocols and Main/
Shared independent scheduling remain unchanged.

The old publication path could accept a resolved false/undefined receipt and
could read a newer receipt in place of the failed original. Negative implementation
coverage demonstrates that skipping the captured evidence check publishes falsely.
Production journal append returns true after transaction completion.

Validation: deterministic scheduling, failed/IDB-only commits, retained generations,
offline intent, folder independence, secondary rejection, disposal/drain, strict
actual owner bodies/negative consumers, LF and CRLF preview mutations, module/startup
budgets. Full native IDB, PostgreSQL, PWA and Windows run in branch CI.
