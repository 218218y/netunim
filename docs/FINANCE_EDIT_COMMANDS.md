# Orders manual financial commands

The Finance controller composes four manual command owners:

| Owner | Write authority |
| --- | --- |
| `cashflow-commands.js` | Kupa document settings, with independent home/business values |
| `bank-archive-commands.js` | Server-confirmed handled/missing/alert changes and verified Morning link projection |
| `credit-settings-commands.js` | Manual profile/reset, mapping, ordering and warning acknowledgement |
| `connection-commands.js` | Local Bridge pairing/configuration commands and their presentation state |

The controller retains admission, shared busy/error presentation and accepted-work
drain. Existing UI method forwarding remains at that boundary. Provider acquisition,
lease execution, automatic refresh and Main/Finance publication stay with their
existing owners. Graph guards prohibit acquiring providers/leases in manual
command modules.

An immutable fixture captured from `aa12f2f3` compares every extracted function's
tokens with its original body. Behavior tests check invalid settings before
document writes, home/business independence and suppression of an old account's
archive publication. Existing Finance operation, publication, connection and
composition tests continue through the actual command owners.

This slice does not claim full static coverage of the Finance controller or all
RPC envelopes. Those remain explicit contract work; it does not change the
provider retry/fallback policies or storage protocol.
