import {CHECKS_PENDING_KEY, LEGACY_CHECKS_PENDING_KEY} from '../state/constants.js';

const CHECKS_OUTBOX_KEY='shared-checks-outbox-v3';

// Read only the presence of a retired outbox for the remaining transition
// preflight. V1 checks, bank events and pending payloads are never hydrated.
export function createStorageChecks({checksSession,idbGet}){
  async function verifyLegacyChecksClean(){
    const commit=checksSession.checksOutboxCommitPromise;
    await commit;
    const durable=await idbGet(CHECKS_OUTBOX_KEY);
    return checksSession.checksOutboxCommitPromise===commit&&durable==null&&
      !checksSession.checksOutboxCached&&localStorage.getItem(CHECKS_PENDING_KEY)==null&&
      localStorage.getItem(LEGACY_CHECKS_PENDING_KEY)==null;
  }
  return {verifyLegacyChecksClean};
}
