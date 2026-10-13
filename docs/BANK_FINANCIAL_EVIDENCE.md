# Bank financial evidence boundary

Baseline: `e5de1cc50ec61fad76bed23614bb848ab0629fc6` (PR #163).

Ten before-change controller tests reproduced missing/coercible balances being
published as zero and unknown optional money being stored as zero. Five more
tests reproduced the same defect in the actual Hapoalim account reader, before
the browser could distinguish the missing value. Two pairing tests proved a
version check could authorize a different device after pairing replacement.

## One scalar policy at the provider and browser boundaries

`shared/bank-money-value.js` is the canonical strict implementation. Finite
numbers and nonblank numeric strings remain valid, including genuine zero and
negative balances. Missing, blank, nonfinite, boolean and object/array values
provide no numeric evidence. Optional unavailable fields remain `null`.

The Hapoalim reader consumes the same scalar policy through the standalone
generated `bank-money-value.mjs`. A missing business balance still produces the
existing `NO_BALANCE` / `balance` stage error before transaction requests. A
missing home balance follows the existing partial-home failure path; successful
business data survives and the application retains its last good home feed.
Retry, pagination, timeouts, account selection and diagnostics policy are unchanged.

Both application controllers decode the received account financial fields
through `readBankBalanceResult()` after their ownership guard and before any
archive write. `bankSnapshotFinancials()` consumes only immutable accounts
constructed by this decoder. A private symbol and WeakSet reject forged,
copied or serialized objects as publication evidence; neither is persisted.
This evidence concerns financial values, not a cloud ACK or an account lease.

Bank Bridge is version **74**. Both applications require v74 before scanning;
Kupa now checks the actual installed version even when no status panel was
opened. The installer health gate also requires v74 and stages the generated
scalar dependency. Older installed runtimes could already have turned absence
into zero, so browser decoding alone cannot make their responses reliable.

**Rollout:** run the updated `install_bank_bridge.bat` on every computer that
uses Bank synchronization. Credit Connector contract v2 and existing credential
vault/data formats remain unchanged. An older Bank runtime is blocked with the
existing installer instruction; it is not silently accepted as corrected.

## Authority and accepted work

Bank operations in both applications capture local pairing authority separately
from their account authority. Version preflight, provider response and archive/
publication work must still belong to the captured device. Storage read failure
or an observed pairing generation change fences that permit with a sanitized
error. Lease renewal/release continue to use the original account guard.

Kupa Bank uses the canonical accepted-task owner, entering commands immediately
instead of delaying acceptance to another microtask. Closing rejects new work;
accepted operations remain drainable through their existing cleanup. Local
connection/status/credential orchestration still needs further decomposition.

## Preservation and verification

Deployed SQL, journal schemas, immutable historical readers, cloud receipts and
RPC bodies are unchanged. Existing numeric strings and flat/dual-account input
formats remain accepted. Optional unknown money is intentionally corrected;
known zero remains known. The surrounding historical AST fixtures remain
immutable: test normalization reverses only these explicit money/authority
boundary deltas, with behavioral and boundary tests independently requiring
the new validation. Error stage/code and provider retry/fallback bodies remain
protected by their original policy fixtures.

Strict implementation/negative consumers and actual body mutations cover the
scalar, decoded financial evidence, publication-field consumer and pairing
guard. Tests exercise both real controller paths, the actual Hapoalim reader,
partial-home failure and installer transitive packaging. Fourteen production
browser cases use the real loopback decoder and native Main/Shared IndexedDB:
invalid business/home balances, blank balance, explicit zero, nullable fields,
old runtime and pairing handoff. Rejected results preserve exact Main/Shared
records; successful results preserve all independent durable data while Kupa's
normal acknowledged Main checkpoint may advance. A normal Shared checkpoint
timestamp/checksum refresh is verified through the actual decoder, with its
journal/base/control/identity and business data retained. The tests reload the
retained note with its original ID/content.

`sync-assets.py` owns deterministic copies of the scalar source in both sites
and the standalone Bridge, including the proposed Git-index snapshot. Generated
copies are intentional; edit the canonical source.
