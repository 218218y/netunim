// @ts-check
// Read-only compatibility for V2 records written during the earlier rollout.
// New bootstrap plans and journals must never create these forms.
const HISTORICAL_BOOTSTRAP_INTENTS=new Set(['first-cloud','legacy-upgrade']);

/** @param {unknown} intent */
export function isHistoricalBootstrapIntent(intent){return typeof intent==='string'&&HISTORICAL_BOOTSTRAP_INTENTS.has(intent)}
/** @param {unknown} intent */
export function isHistoricalBootstrapSideIntent(intent){return intent==='upload-owner'}

/** @param {{transferIntent?:unknown,phase?:unknown}} group */
export function completedHistoricalBootstrapGroup(group){
  if(!isHistoricalBootstrapIntent(group.transferIntent))return false;
  if(group.phase!=='complete')throw new Error('storage_bootstrap_historical_incomplete');
  return true;
}

/** @param {{appMetadata?:import('./storage-json.js').StorageJsonObject|null}} operation */
export function isHistoricalUploadOwnerBootstrap(operation){
  const metadata=operation.appMetadata,target=metadata?.targetOwner;
  return metadata?.migrationIntent==='upload-owner'&&typeof target==='string'&&target.length>0&&target.length<=512&&metadata.sourceOwner===target;
}

/** @param {unknown} side */
export function historicalShadowRoleForSide(side){
  if(side==='main')return 'shadow';
  if(side==='shared')return 'shared-checks-shadow';
  throw new Error('storage_historical_shadow_side_invalid');
}
