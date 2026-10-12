import {mergeArray} from './merge-records.js';
import {normalizeSharedChecks} from '../shared/shared-checks-contract.js';
import {clone} from '../core/values.js';

// Missing records are deletions only when accompanied by explicit delete IDs.
// This policy is also used by detached recovery, without starting a sync owner.
function protectImplicitDeletes(base, local, deleteIds) {
  const allowed = new Set((Array.isArray(deleteIds) ? deleteIds : []).map(value => String(value || '').trim()).filter(Boolean));
  const safe = normalizeSharedChecks(local || []), present = new Set(safe.map(item => item.id));
  for (const item of normalizeSharedChecks(base || [])) {
    if (item?.id && !present.has(item.id) && !allowed.has(item.id)) {
      safe.push(clone(item));
      present.add(item.id);
    }
  }
  return safe;
}

export function mergeSharedChecks(base, local, remote, {deleteIds=[]}={}) {
  const conflicts = [];
  const checks = mergeArray(normalizeSharedChecks(base || []), protectImplicitDeletes(base, local, deleteIds),
    normalizeSharedChecks(remote || []), 'id', conflicts, 'check');
  return {checks:normalizeSharedChecks(checks), conflicts};
}
