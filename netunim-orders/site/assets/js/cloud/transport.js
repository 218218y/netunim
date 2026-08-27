import {validOrderCloudState} from '../state/validation.js';
import {normalizeSharedChecks} from '../domains/checks/model.js';
import {CLOUD_DOC, CLOUD_TABLE, CLOUD_RPC, SHARED_CHECKS_DOC, SHARED_CHECKS_TABLE, KUPA_READ_DOC, KUPA_READ_TABLE, SHARED_CHECKS_RPC} from '../state/constants.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createCloudTransport({supaFetch}){
async function readCloud(){const r=await supaFetch(`/rest/v1/${CLOUD_TABLE}?document_name=eq.${encodeURIComponent(CLOUD_DOC)}&select=document_name,revision,state,updated_at`,{method:'GET'});const j=await r.json().catch(()=>null);if(!r.ok)throw new Error(j?.message||'קריאת הענן נכשלה');const row=Array.isArray(j)&&j.length?j[0]:null;if(row&&!validOrderCloudState(row.state))throw new Error('מסמך ניהול ההזמנות בענן עדיין אינו במבנה ה-cutover החדש. הסנכרון נעצר כדי למנוע מצב מפוצל.');return row}

async function readCloudMeta(){const r=await supaFetch(`/rest/v1/${CLOUD_TABLE}?document_name=eq.${encodeURIComponent(CLOUD_DOC)}&select=document_name,revision,updated_at`,{method:'GET'});const j=await r.json().catch(()=>null);if(!r.ok)throw new Error(j?.message||'קריאת סטטוס הענן נכשלה');return Array.isArray(j)&&j.length?j[0]:null}

async function rpcSave(snapshot,expected){const r=await supaFetch(`/rest/v1/rpc/${CLOUD_RPC}`,{method:'POST',body:JSON.stringify({p_document_name:CLOUD_DOC,p_expected_revision:Number(expected||0),p_state:snapshot})});const txt=await r.text();let j;try{j=txt?JSON.parse(txt):null}catch(e){j=null}return{r,j,txt,row:Array.isArray(j)?j[0]:j}}

async function readSharedChecksCloud(){const r=await supaFetch(`/rest/v1/${SHARED_CHECKS_TABLE}?document_name=eq.${encodeURIComponent(SHARED_CHECKS_DOC)}&select=document_name,revision,state,updated_at`,{method:'GET'});const j=await r.json().catch(()=>null);if(!r.ok)throw new Error(j?.message||'קריאת הצ\'קים המשותפים מהענן נכשלה');const row=Array.isArray(j)&&j.length?j[0]:null;if(row){if(!row.state||!Array.isArray(row.state.checks)||!Array.isArray(row.state.bankEvents))throw new Error('מסמך הצ\'קים המשותף בענן במבנה לא תקין');const rev=Number(row.revision);if(!Number.isSafeInteger(rev)||rev<1)throw new Error('Revision הצ\'קים המשותף אינו תקין')}return row}

async function readSharedChecksCloudMeta(){const r=await supaFetch(`/rest/v1/${SHARED_CHECKS_TABLE}?document_name=eq.${encodeURIComponent(SHARED_CHECKS_DOC)}&select=document_name,revision,updated_at`,{method:'GET'});const j=await r.json().catch(()=>null);if(!r.ok)throw new Error(j?.message||'קריאת סטטוס הצ\'קים המשותפים נכשלה');return Array.isArray(j)&&j.length?j[0]:null}

async function readKupaReadOnlyCloud(){const r=await supaFetch(`/rest/v1/${KUPA_READ_TABLE}?document_name=eq.${encodeURIComponent(KUPA_READ_DOC)}&select=document_name,revision,state,updated_at`,{method:'GET'});const j=await r.json().catch(()=>null);if(!r.ok)throw new Error(j?.message||'קריאת נתוני הקופה לחישוב נכשלה');return Array.isArray(j)&&j.length?j[0]:null}

async function readKupaReadOnlyMeta(){const r=await supaFetch(`/rest/v1/${KUPA_READ_TABLE}?document_name=eq.${encodeURIComponent(KUPA_READ_DOC)}&select=document_name,revision,updated_at`,{method:'GET'});const j=await r.json().catch(()=>null);if(!r.ok)throw new Error(j?.message||'קריאת סטטוס הקופה לחישוב נכשלה');return Array.isArray(j)&&j.length?j[0]:null}

async function rpcSaveSharedChecks(checks,expectedRevision){const payload={version:1,checks:normalizeSharedChecks(checks)},expected=Number(expectedRevision||0);if(!Number.isSafeInteger(expected)||expected<0)throw new Error('Revision הצ\'קים המקומי אינו תקין');const r=await supaFetch(`/rest/v1/rpc/${SHARED_CHECKS_RPC}`,{method:'POST',body:JSON.stringify({p_document_name:SHARED_CHECKS_DOC,p_expected_revision:expected,p_state:payload})});const txt=await r.text();let j;try{j=txt?JSON.parse(txt):null}catch(e){j=null}return {r,j,txt,row:Array.isArray(j)?j[0]:j}}

return { readCloud, readCloudMeta, rpcSave, readSharedChecksCloud, readSharedChecksCloudMeta, readKupaReadOnlyCloud, readKupaReadOnlyMeta, rpcSaveSharedChecks };
}
