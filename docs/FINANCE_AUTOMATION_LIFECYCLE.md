# Finance automatic lifetime, 2026-10-25

A retained Orders Finance controller could call start/resume after its runtime
was disposed. Its scheduler had only a resumable stop: the reproduced regression
recreated two timers and still allowed computer-preference writes. The controller
now disposes that same existing scheduler. No new scheduler or provider path is
introduced.

Stop remains reversible for connectivity/account/startup recovery. Dispose is
terminal and idempotent. It closes automatic entry, timers, enable/mode/attempt
preference mutation and stale timer callbacks. Accepted provider work retains
its existing independent operation guard, lease cleanup and drain; disposal
does not grant a save receipt or replace the transaction owners.

The regression first failed against the original actual controller with two
resurrected timers. It passes after the fix. A direct scheduler test retains
stale callbacks and proves no preference bytes change after disposal. Existing
startup epoch/deadline, failed-preference suspension and accepted-provider/lease
ownership tests remain in force.

The actual automatic scheduler now checks strictly through explicit access,
preference, command and timer ports. Negative consumers reject deferred access
and authority, missing commands, wrong timer handles and arbitrary domains.
Implementation mutations replace the captured guard with an async function and
the numeric timer handle with text. This checks this owner, not every Finance
controller body. No eager module or storage schema is added.
