import {assertValidCloudState} from '../state/validation.js';
import {normalizeSharedChecks} from '../domains/checks/model.js';
import {SHARED_CHECKS_DOC, SHARED_CHECKS_TABLE, SHARED_CHECKS_RPC} from '../state/constants.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createCloudTransport({session, supaRest}){
async function readSupabaseDocument(){
  const q=`/rest/v1/kupa_documents?document_name=eq.${encodeURIComponent(session.cloudDocumentName)}&select=document_name,revision,state,updated_at`;
  const r=await supaRest(q,{method:'GET'}),j=await r.json().catch(()=>null);
  if(!r.ok)throw new Error(j?.message||j?.hint||'קריאת הקופה מהענן נכשלה');
  const row=Array.isArray(j)&&j.length?j[0]:null;
  if(row){
    assertValidCloudState(row.state,'מסמך הקופה בענן');
    const rev=Number(row.revision);
    if(!Number.isSafeInteger(rev)||rev<1)throw new Error('Revision הקופה בענן אינו תקין. הסנכרון נעצר כדי למנוע דריסה.');
  }
  return row
}

async function readSharedChecksDocument(){
  const q=`/rest/v1/${SHARED_CHECKS_TABLE}?document_name=eq.${encodeURIComponent(SHARED_CHECKS_DOC)}&select=document_name,revision,state,updated_at`;
  const r=await supaRest(q,{method:'GET'}),j=await r.json().catch(()=>null);
  if(!r.ok)throw new Error(j?.message||j?.hint||'קריאת מאגר הצקים המשותף נכשלה');
  const row=Array.isArray(j)&&j.length?j[0]:null;
  if(row){if(!row.state||!Array.isArray(row.state.checks)||!Array.isArray(row.state.bankEvents))throw new Error('מסמך הצקים המשותף בענן במבנה לא תקין');const rev=Number(row.revision);if(!Number.isSafeInteger(rev)||rev<1)throw new Error('Revision הצקים המשותף אינו תקין')}
  return row
}

async function readSharedChecksMeta(){
  const q=`/rest/v1/${SHARED_CHECKS_TABLE}?document_name=eq.${encodeURIComponent(SHARED_CHECKS_DOC)}&select=document_name,revision,updated_at`;
  const r=await supaRest(q,{method:'GET'}),j=await r.json().catch(()=>null);if(!r.ok)throw new Error(j?.message||'קריאת סטטוס הצקים המשותפים נכשלה');return Array.isArray(j)&&j.length?j[0]:null
}

async function rpcSaveSharedChecks(checks,expectedRevision){
  const payload={version:1,checks:normalizeSharedChecks(checks)},expected=Number(expectedRevision||0);if(!Number.isSafeInteger(expected)||expected<0)throw new Error('Revision הצקים המקומי אינו תקין');
  const r=await supaRest(`/rest/v1/rpc/${SHARED_CHECKS_RPC}`,{method:'POST',body:JSON.stringify({p_document_name:SHARED_CHECKS_DOC,p_expected_revision:expected,p_state:payload})});const body=await r.text();let j;try{j=body?JSON.parse(body):null}catch(e){j=null}return {r,j,body,row:Array.isArray(j)?j[0]:j}
}

return { readSupabaseDocument, readSharedChecksDocument, readSharedChecksMeta, rpcSaveSharedChecks };
}
