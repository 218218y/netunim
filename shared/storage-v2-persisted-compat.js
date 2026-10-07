// Read-only compatibility for V2 records written during the earlier rollout.
// New bootstrap plans and journals must never create these forms.
const HISTORICAL_BOOTSTRAP_INTENTS=new Set(['first-cloud','legacy-upgrade']);

export function isHistoricalBootstrapIntent(intent){return HISTORICAL_BOOTSTRAP_INTENTS.has(intent)}
export function isHistoricalBootstrapSideIntent(intent){return intent==='upload-owner'}

export function completedHistoricalBootstrapGroup(group){
  if(!isHistoricalBootstrapIntent(group.transferIntent))return false;
  if(group.phase!=='complete')throw new Error('storage_bootstrap_historical_incomplete');
  return true;
}

export function isHistoricalUploadOwnerBootstrap(operation){
  const metadata=operation.appMetadata,target=metadata?.targetOwner;
  return metadata?.migrationIntent==='upload-owner'&&typeof target==='string'&&target.length>0&&target.length<=512&&metadata.sourceOwner===target;
}

export function historicalShadowRoleForSide(side){
  if(side==='main')return 'shadow';
  if(side==='shared')return 'shared-checks-shadow';
  throw new Error('storage_historical_shadow_side_invalid');
}
