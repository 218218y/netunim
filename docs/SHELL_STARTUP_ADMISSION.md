# Shell startup admission

The composition audit found policy in both lifecycle modules: transfer resume,
local-birth completion and account/local marker admission. Those decisions now
belong to createStorageStartupAdmission in the existing checked startup protocol
module. Lifecycle retains application messages and ordering of journal recovery,
cloud preparation, initial display and optional services.

Admission allows owner changes only through successful explicit transfer, then
reads fresh account and local markers. A retained transfer/birth cannot report
ready. Secondary viewing never runs either writer. Both shells recheck owner and
primary-tab authority after journal recovery and before display activation;
late ownership/leadership loss rejects boot and retains the mutation gate.
Marker reads and server protocol waits cannot mix owners. Fenced adoption
rereads both markers instead of carrying local readiness into the account.
Browser connectivity is supplied by the composition roots. Storage coordinators
construct admission from their private transfer/birth owners; lifecycle consumes
that capability instead of receiving and rebuilding the individual policy ports.

No AppContext or dependency-count target was introduced. Backup/cloud UI already
wire role ports and navigation owns view interaction; their width alone is not
an extraction reason. Existing cloud/local/background capability owners remain.

Evidence: strict checked admission body and negative consumers; interrupted
birth/transfer, retained-marker, secondary and stale-owner matrices; both real
lifecycle factories tested on owner/leadership loss during journal recovery;
actual implementation mutation removing leadership checks. Existing native
local/offline, account handoff, recovery/readiness and startup gates also run.
No new eager module or raised startup ceiling was needed.
