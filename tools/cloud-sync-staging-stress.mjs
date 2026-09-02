import assert from 'node:assert/strict';

const PRODUCTION_PROJECT_REF='bupoidcurcxuypfrjqio';
const url=String(process.env.NETUNIM_STAGING_URL||'').replace(/\/$/,'');
const key=String(process.env.NETUNIM_STAGING_PUBLISHABLE_KEY||'');
const token=String(process.env.NETUNIM_STAGING_ACCESS_TOKEN||'');
const ownerId=String(process.env.NETUNIM_STAGING_OWNER_ID||'');
const projectRef=String(process.env.NETUNIM_STAGING_PROJECT_REF||'');
const concurrency=Math.max(2,Math.min(100,Number(process.env.NETUNIM_STAGING_CONCURRENCY)||50));

function refuse(message){throw new Error(`STAGING STRESS REFUSED: ${message}`)}
if(process.env.NETUNIM_STAGING_CONFIRM!=='staging-only')refuse('set NETUNIM_STAGING_CONFIRM=staging-only');
if(!/^https:\/\/[a-z0-9]+\.supabase\.co$/i.test(url))refuse('NETUNIM_STAGING_URL must be an exact Supabase project URL');
if(!projectRef||!url.includes(`//${projectRef}.`))refuse('NETUNIM_STAGING_PROJECT_REF must match the URL');
if(projectRef===PRODUCTION_PROJECT_REF)refuse('the configured project is the known production project');
if(!key||!token||!ownerId)refuse('publishable key, access token and dedicated owner id are required');
try{
  const payload=JSON.parse(Buffer.from(token.split('.')[1]||'','base64url').toString('utf8'));
  if(String(payload.sub||'')!==ownerId)refuse('access-token owner does not match NETUNIM_STAGING_OWNER_ID');
}catch(error){if(String(error.message).startsWith('STAGING STRESS REFUSED'))throw error;refuse('access token is not a readable JWT')}

const headers={'apikey':key,'Authorization':`Bearer ${token}`,'Content-Type':'application/json'};
async function request(path,options={}){
  const started=performance.now(),response=await fetch(`${url}${path}`,{...options,headers:{...headers,...options.headers}}),text=await response.text();
  let body=null;try{body=text?JSON.parse(text):null}catch{body=text}
  return {status:response.status,ok:response.ok,body,elapsedMs:performance.now()-started};
}
async function readOne(table,documentName){
  const result=await request(`/rest/v1/${table}?document_name=eq.${encodeURIComponent(documentName)}&select=revision,state,updated_at`,{method:'GET'});
  assert.equal(result.ok,true,`${table} read failed: ${JSON.stringify(result.body)}`);
  const row=Array.isArray(result.body)?result.body[0]:null;assert.ok(row,`${table}/${documentName} is missing for the dedicated staging user`);return row;
}
function rowOf(result){return Array.isArray(result.body)?result.body[0]:result.body}
function percentile(sorted,fraction){return sorted[Math.min(sorted.length-1,Math.max(0,Math.ceil(sorted.length*fraction)-1))]}
function stats(samples){const sorted=[...samples].sort((a,b)=>a-b);return {count:sorted.length,p50Ms:+percentile(sorted,.50).toFixed(2),p95Ms:+percentile(sorted,.95).toFixed(2),p99Ms:+percentile(sorted,.99).toFixed(2),maxMs:+sorted.at(-1).toFixed(2)}}
async function rpc(name,payload){return request(`/rest/v1/rpc/${name}`,{method:'POST',body:JSON.stringify(payload)})}

async function stressDocument({label,table,documentName,rpcName,makeState}){
  const before=await readOne(table,documentName),candidate=makeState(structuredClone(before.state));
  const calls=await Promise.all(Array.from({length:concurrency},()=>rpc(rpcName,{p_document_name:documentName,p_expected_revision:Number(before.revision),p_state:candidate})));
  const unexpected=calls.filter(call=>![200,409,429].includes(call.status));assert.deepEqual(unexpected.map(call=>({status:call.status,body:call.body})),[],`${label} returned unexpected responses`);
  assert.equal(calls.some(call=>call.status===200),true,`${label} had no successful writer`);
  const after=await readOne(table,documentName);assert.deepEqual(after.state,candidate,`${label} final state differs from the intended state`);assert.equal(Number(after.revision),Number(before.revision)+1,`${label} replay bumped more than one revision`);
  const restore=await rpc(rpcName,{p_document_name:documentName,p_expected_revision:Number(after.revision),p_state:before.state});assert.equal(restore.ok,true,`${label} restore failed`);
  return {label,statuses:Object.fromEntries([200,409,429].map(status=>[status,calls.filter(call=>call.status===status).length])),latency:stats(calls.map(call=>call.elapsedMs))};
}

const marker=crypto.randomUUID();
const [orders,kupa]=await Promise.all([
  stressDocument({label:'orders',table:'order_management_documents',documentName:'suppliers',rpcName:'save_order_management_document',makeState:state=>({...state,_syncV3Stress:marker})}),
  stressDocument({label:'kupa',table:'kupa_documents',documentName:'main',rpcName:'save_kupa_document',makeState:state=>({...state,_syncV3Stress:marker})}),
]);

const checks=await stressDocument({
  label:'shared-checks',table:'shared_checks_documents',documentName:'main',rpcName:'save_shared_checks_document',
  makeState:state=>{
    const list=Array.isArray(state.checks)?state.checks:[];
    const next=list.length?[{...list[0],_syncV3Stress:marker},...list.slice(1)]:[{id:`sync-v3-${marker}`,amount:0,dueDate:'2026-01-01',status:'בקופה',depositSeq:null,depositedAt:null,_syncV3Stress:marker}];
    return {version:1,checks:next,bankEvents:Array.isArray(state.bankEvents)?state.bankEvents:[]};
  },
});

const finance=await stressDocument({label:'finance',table:'finance_sync_documents',documentName:'main',rpcName:'save_finance_sync_document',makeState:state=>({...state,_syncV3Stress:marker})});

const financeRow=await readOne('finance_sync_documents','main'),kupaRow=await readOne('kupa_documents','main');
const bankState=financeRow.state?.bank,snapshotSeq=Math.max(0,Number(kupaRow.state?.bank?.snapshotSeq)||0),snapshotToken=`sync-v3-staging-${marker}`;
assert.ok(bankState&&typeof bankState==='object','finance bank state is missing');
const bankFirst=await rpc('save_bank_sync_snapshot',{p_document_name:'main',p_bank_state:bankState,p_snapshot_token:snapshotToken,p_snapshot_seq:snapshotSeq});assert.equal(bankFirst.ok,true,`bank snapshot failed: ${JSON.stringify(bankFirst.body)}`);
const bankReplay=await rpc('save_bank_sync_snapshot',{p_document_name:'main',p_bank_state:bankState,p_snapshot_token:snapshotToken,p_snapshot_seq:snapshotSeq});assert.equal(bankReplay.ok,true,`bank replay failed: ${JSON.stringify(bankReplay.body)}`);assert.deepEqual(rowOf(bankReplay),rowOf(bankFirst),'bank replay changed revisions');
const bankReuse=await rpc('save_bank_sync_snapshot',{p_document_name:'main',p_bank_state:{...bankState,_syncV3Stress:'different'},p_snapshot_token:snapshotToken,p_snapshot_seq:snapshotSeq});assert.equal(bankReuse.status,422,'bank token reuse with a different payload was not rejected');

const mergeKey=`sync-v3-staging-${marker}`,batch=[{mergeKey,date:'2026-01-02T10:00:00Z',processedDate:'2026-01-02T10:00:00Z',amount:1,currency:'ILS',description:'sync-v3-staging',memo:'same',status:'completed',bankReference:mergeKey,bankSerial:'0',cheque:false}];
const mergeFirst=await rpc('merge_bank_transactions',{p_account_key:'sync-v3-staging',p_account_role:'business',p_transactions:batch}),mergeReplay=await rpc('merge_bank_transactions',{p_account_key:'sync-v3-staging',p_account_role:'business',p_transactions:batch});
assert.equal(mergeFirst.ok,true);assert.equal(mergeReplay.ok,true);assert.equal(Number(rowOf(mergeReplay)?.inserted_count),0);assert.equal(Number(rowOf(mergeReplay)?.updated_count),0);

const leaseToken=`sync-v3-staging-${marker}`,leaseFirst=await rpc('claim_finance_sync_lease',{p_lease_name:'bank',p_lease_token:leaseToken,p_ttl_seconds:120}),leaseReplay=await rpc('claim_finance_sync_lease',{p_lease_name:'bank',p_lease_token:leaseToken,p_ttl_seconds:120}),leaseOther=await rpc('claim_finance_sync_lease',{p_lease_name:'bank',p_lease_token:`${leaseToken}-other`,p_ttl_seconds:120});
assert.equal(rowOf(leaseFirst)?.acquired,true);assert.equal(rowOf(leaseReplay)?.acquired,true);assert.equal(rowOf(leaseOther)?.acquired,false);
const releaseFirst=await rpc('release_finance_sync_lease',{p_lease_name:'bank',p_lease_token:leaseToken}),releaseReplay=await rpc('release_finance_sync_lease',{p_lease_name:'bank',p_lease_token:leaseToken});assert.equal(rowOf(releaseFirst),true);assert.equal(rowOf(releaseReplay),true);

console.log(JSON.stringify({projectRef,ownerId,concurrency,documents:[orders,kupa,checks,finance],bank:{first:rowOf(bankFirst),replay:rowOf(bankReplay),reuseStatus:bankReuse.status,latency:stats([bankFirst.elapsedMs,bankReplay.elapsedMs])},merge:{first:rowOf(mergeFirst),replay:rowOf(mergeReplay)},lease:{first:rowOf(leaseFirst),replay:rowOf(leaseReplay),other:rowOf(leaseOther),release:[rowOf(releaseFirst),rowOf(releaseReplay)]}},null,2));
