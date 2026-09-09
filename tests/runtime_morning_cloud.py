"""Local cloud transport fixture. Production refresh, merge and outbox remain intact."""
LOCAL_CLOUD = r"""
window.auditCloudReads=0;
window.auditCloudFail=false;
window.auditCloudReadGate=null;
window.auditCloudHead=null;
cloudAuth.cloudEnabled=()=>true;
cloudTransport.readCloud=async()=>{
 window.auditCloudReads++;
 if(window.auditCloudReadGate)await window.auditCloudReadGate;
 if(window.auditCloudFail)throw new Error('fixture cloud unavailable');
 return structuredClone(window.auditCloudHead||{revision:cloudRevision||1,state:prepareCloudState(state)});
};
cloudTransport.readCloudMeta=async()=>({revision:window.auditCloudHead?.revision||cloudRevision||1});
cloudTransport.rpcSave=async(snapshot,expected)=>{
 if(window.auditCloudFail)throw new Error('fixture cloud unavailable');
 const revision=window.auditCloudHead?.revision??expected;
 if(expected!==revision)return {r:{ok:false,status:409},j:{code:'PT409',message:'revision_conflict'}};
 const row={revision:expected+1,state:structuredClone(snapshot)};
 if(window.auditCloudHead)window.auditCloudHead=structuredClone(row);
 return {r:{ok:true},row};
};
"""
