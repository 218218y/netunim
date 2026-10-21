import {commitCloudCheckpoint} from '../shared/cloud-checkpoint-publication.js';
import {hasFailedLocalMutation} from '../shared/local-mutation-admission.js';

// Commits the durable checkpoint before visible remote publication. Independent
// Finance and Shared Checks keep their original journals and ordering fences.
export function createRemoteAdoption({model,session,tab,access,journal,projection,view}){
const {cloudEnabled}=access;
const {adoptStorageV2CloudHead,setStorageV2CloudControl}=journal;
const {composeOrderCloudState,applyOrderCloudState,prepareCloudState}=projection;
const {setCloud}=view;
async function adoptRemoteRow(row,generation,head,{applyState=true}={}){
  if(hasFailedLocalMutation(session))return false;
  if(!head?.base)throw new Error('orders_v2_account_head_required');
  const revision=Number(row.revision),next=composeOrderCloudState(row.state,model.state);
  const publication=await commitCloudCheckpoint({
    commit:()=>adoptStorageV2CloudHead(revision,next,{expectedHead:{seq:head.seq,baseRevision:head.base.revision}}),
    isCurrent:committed=>!hasFailedLocalMutation(session)&&committed?.seq===head.seq&&committed?.revision===revision&&!committed.pending&&!committed.control&&tab.primaryTab&&cloudEnabled()&&Number(session.localGeneration||0)===generation,
    publish:()=>{if(applyState)applyOrderCloudState(row.state);session.cloudRevision=revision;session.cloudUpdatedAt=row.updated_at||session.cloudUpdatedAt;session.lastCloudState=prepareCloudState(model.state)},
  });
  if(!publication.published&&tab.primaryTab&&cloudEnabled()){
    session.cloudConflictBlocked=true;session.cloudSaveRequested=false;
    if(!publication.committed?.control?.conflict)await setStorageV2CloudControl({conflict:{kind:publication.reason==='publication-error'?'cloud-publication-failed':'concurrent-hydration',domain:'orders',baseRevision:head.base.revision,currentRemoteRevision:revision}});
    setCloud('ענן: נדרשת בדיקת סנכרון','error');
  }
  if(publication.reason==='publication-error')throw publication.error;
  return publication.published;
}

return {adoptRemoteRow};
}
