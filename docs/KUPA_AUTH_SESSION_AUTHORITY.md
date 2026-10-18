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

Evidence: `auth_session_persistence.test.mjs`, existing auth/account/browser
observation suites, and the strict checked implementation with negative consumers
in `checked-auth-session-persistence.mjs`. Physical process interruption remains a
separate release exercise; these tests inject controlled storage/network failures.
