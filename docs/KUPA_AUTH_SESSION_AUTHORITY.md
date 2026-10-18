# Kupa credential authority, 2026-10-18

`cloud/session-store.js` owns local credential persistence. The synchronous
localStorage session record is authoritative; JSON `null` is a retained logout
tombstone. IndexedDB is an ordered compatibility mirror, and is eligible for
one-time migration only when the local record is absent. Read errors and malformed
local records fail closed. A failed IDB cleanup is reported without reversing a
durably recorded logout. A failed local authority write revokes this instance and
throws; the UI cannot claim that the credentials were removed from this computer.

Historical restore captures its generation and rereads local authority after IDB
returns. Logout/new login therefore wins over a late historical read. Mirror writes
capture their payload before queuing and delete/write operations drain in order.

Refresh flights belong to one auth instance and login epoch. Their scope is captured
before waiting for a browser lock. Both refresh replies and password login replies
are rejected if logout or account replacement occurred while they were pending.
Business data ownership and the Storage V2 writer remain unchanged.

The deterministic eager graph changes from 300 to 301 modules and measures
1,749,511 source bytes on the branch. Only the module-count ceiling is adjusted
for this required authority owner; the 1,753,000-byte and all native/4x CPU timing
ceilings remain unchanged. Full CI's startup timing suite passed on the initial
candidate. The Finance automation runtime fixture now uses the real auth command
instead of mutating its credential projection directly.

Evidence: `auth_session_persistence.test.mjs`, existing auth/account/browser
observation suites, and the strict checked implementation with negative consumers
in `checked-auth-session-persistence.mjs`. Physical process interruption remains a
separate release exercise; these tests inject controlled storage/network failures.
