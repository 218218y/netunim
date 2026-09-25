// These are business-storage records only. Session, preferences, tab leases,
// workbook handles and V2 emergency records are deliberately excluded.
export const LEGACY_BUSINESS_KEYS=Object.freeze({
  orders:Object.freeze([
    'orders.management.state.v1','orders.supabase.base.v1','orders.supabase.pending.v1',
    'orders.shared.checks.base.v1','orders.shared.checks.bank-events.v1',
    'orders.shared.checks.pending.v1','orders.kupa.checks.base.v1',
    'orders.kupa.checks.pending.v1',
  ]),
  kupa:Object.freeze([
    'kupa.browser.state.v1','kupa.cloud.pending.local.v1',
    'kupa.shared.checks.base.v1','kupa.shared.checks.bank-events.v1',
    'kupa.shared.checks.pending.v1',
  ]),
});

export const legacyRetirementKey=(app,owner)=>`netunim-storage-v2-legacy-retired:${app}:${encodeURIComponent(owner)}`;

// Retirement is repeatable rather than phase-based: once both V2 journals and
// the durable marker are verified, no legacy record is needed for recovery.
// A crash after any deletion simply leaves fewer known keys for the next run.
export async function retireLegacyBusinessStorage({app,owner,ownerNow,primaryReady,verifyV2,readProtocolState,storage,deleteRecords}={}){
  if(!LEGACY_BUSINESS_KEYS[app]||!owner||typeof ownerNow!=='function'||typeof primaryReady!=='function'||typeof verifyV2!=='function'||typeof deleteRecords!=='function'||!storage)throw new Error('storage_legacy_retirement_configuration');
  const current=()=>ownerNow()===owner&&primaryReady()===true;
  const marker=legacyRetirementKey(app,owner);
  if(current()&&storage.getItem(marker)==='2'&&LEGACY_BUSINESS_KEYS[app].every(key=>storage.getItem(key)===null))return true;
  if(!current()||await verifyV2()!==true||!current())return false;
  if(owner!=='local'){
    if(typeof readProtocolState!=='function')throw new Error('storage_legacy_retirement_protocol_required');
    const protocol=await readProtocolState();
    if(!current()||[protocol?.orders,protocol?.kupa,protocol?.sharedChecks].some(value=>value!==2))return false;
  }
  // Delete the durable old records first. If IndexedDB fails, leave the
  // LocalStorage copy intact and retry on a later startup.
  if(!current())return false;
  await deleteRecords();
  if(!current())return false;
  for(const key of LEGACY_BUSINESS_KEYS[app])storage.removeItem(key);
  storage.setItem(marker,'2');
  if(storage.getItem(marker)!=='2')throw new Error('storage_legacy_retirement_marker_failed');
  return true;
}
