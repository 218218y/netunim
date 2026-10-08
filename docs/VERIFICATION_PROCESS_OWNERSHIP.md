# Verification process ownership

## Proven failure

The process-tree review identified an observation gap after a normal suite exit.
The suite parent could already be reaped while its grandchild still owned a
listening socket. POSIX `SuiteProcess.close()` signalled the entire owned group
but waited only for the parent. Sending the signal did not prove that descendants
had finished releasing their resources.

Tests-only commit `01829616` reproduced this in Linux CI run `37770407859`:
200 of 200 confirmed live listeners remained reachable immediately after cleanup
returned. Each fixture recorded its descendant PID and PGID; the PGID matched
the suite's owned process group. The same run's original one-shot normal-exit
test passed, demonstrating why one passing sample was insufficient.

This is a verification infrastructure race. It does not establish application
data corruption or a Storage V2 defect.

## Completion contract

- A suite starts in its own POSIX session/process group. Its group ID is the
  child PID returned by `Popen(start_new_session=True)`.
- Closing signals only that owned group. Windows retains its existing Job Object
  assignment before the child can execute test code, with process-handle waits.
- POSIX cleanup observes live group members after signalling. On Linux it reads
  procfs process state and group; other POSIX hosts read only PID/PGID/state from
  `ps`. Process disappearance during observation is expected. Permission,
  parsing and observer failures propagate as cleanup failures.
- Zombie/dead processes no longer own files or sockets. They do not keep cleanup
  waiting for reaping by a different parent. A live member does keep it waiting.
- While a member remains, a bounded condition loop signals again to include a
  member that forked during termination. The deadline is ten seconds; reaching
  it raises a cleanup error with the group and remaining PIDs.
- The runner still reaps its immediate child and closes its own handles. Scratch
  is removed and `closed` is set only after successful tree completion. Timeout
  retains scratch for diagnosis and cannot turn the suite or gate green.
- No command line, credential, application profile or production data is read by
  process observation. No unrelated process is signalled.

This ownership is for descendants remaining in the suite's group/job. Deliberately
detaching into another POSIX session is outside the suite contract.

## Regression gates

`tests/runner_contracts.py` runs 200 actual POSIX parent/grandchild groups. Before
each close it confirms the grandchild listener is live and the parent exited
normally. Immediately after close it probes the socket, without a grace sleep,
and requires scratch removal. The test is run in Linux CI; it is skipped on
Windows, where the real Job Object tests remain enabled.

The suite also checks normal exit, timeout, cancellation, repeat close, unaffected
sibling groups, and failure reporting. Small decision tests cover newly observed
members, zombie filtering, unusual process names, disappearance during observation,
portable `ps` output, timeout and observation errors. Cleanup failure keeps the
gate failed and preserves scratch. The complete branch CI must pass before merge.

No application JS, sync policy, persistence format, schema or deployment protocol
changes belong to this repair.
