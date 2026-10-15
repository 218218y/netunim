// @ts-check
/** @typedef {()=>undefined} SpreadsheetGuard */
/** @typedef {{ok:boolean,status:number,text:()=>Promise<string>}} SpreadsheetResponse */
/** @typedef {{method?:'GET'|'POST',body?:string,networkRetry:true,dataPriority:'normal',assertRequestScope:SpreadsheetGuard}} SpreadsheetRequest */
/** @typedef {(path:string,options:SpreadsheetRequest)=>Promise<SpreadsheetResponse>} SpreadsheetFetch */
/** @template State @typedef {{revision:number,state:State,updated_at?:string}} SpreadsheetDocument */
/** @template State @typedef {SpreadsheetDocument<State>&{operation_replayed:boolean}} SpreadsheetAck */
/** @typedef {{id:number,revision:number,created_at:string,kind:string}} SpreadsheetBackup */
/** @param {unknown} value @returns {value is Record<string,unknown>} */
function object(value){return value!==null&&typeof value==='object'&&!Array.isArray(value)}
/** @param {string} [part] @returns {never} */
function invalid(part='response'){throw Object.assign(new Error('לא התקבל אישור תקין לסנכרון הגיליון. הפעולה הממתינה נשמרה לניסיון חוזר.'),{code:'SPREADSHEET_RESPONSE_INVALID',kind:'confirmation_unknown',part})}
/** @param {unknown} value @param {number} [minimum] */
function revision(value,minimum=1){
  if(typeof value!=='number'&&(typeof value!=='string'||!/^(0|[1-9]\d*)$/.test(value)))invalid('revision');
  const result=Number(value);
  if(!Number.isSafeInteger(result)||result<minimum)invalid('revision');
  return result;
}
/** @param {unknown} value @param {boolean} missing @returns {Record<string,unknown>|null} */
function row(value,missing){
  if(Array.isArray(value)){
    if(missing&&value.length===0)return null;
    if(value.length!==1)invalid('row count');
    value=value[0];
  }
  if(!object(value))invalid('row');
  return value;
}
/** @param {unknown} value @returns {string} */
function timestamp(value){if(typeof value!=='string'||!value.trim()||!Number.isFinite(Date.parse(value)))invalid('timestamp');return value}

/**
 * The real network/body boundary used by both workbook consumers. State
 * validation retains the existing domain algorithm; raw JSON is always unknown.
 * @template {Record<string,unknown>} State
 * @param {{domain:'kupa'|'orders',request:SpreadsheetFetch,access:{capture:()=>SpreadsheetGuard},
 * decodeState:(raw:unknown)=>State,equalState:(a:State,b:State)=>boolean}} ports
 */
export function createSpreadsheetRemote({domain,request,access,decodeState,equalState}){
  if(!['kupa','orders'].includes(domain)||typeof request!=='function'||typeof access?.capture!=='function'||typeof decodeState!=='function'||typeof equalState!=='function')throw new TypeError('spreadsheet_remote_ports_required');
  /** @param {string} path @param {{method?:'GET'|'POST',body?:string}} [options] @returns {Promise<unknown>} */
  async function api(path,options={}){
    const assertCurrent=access.capture();assertCurrent();
    let response,body;
    try{
      response=await request(path,{...options,networkRetry:true,dataPriority:'normal',assertRequestScope:assertCurrent});
      assertCurrent();body=await response.text();assertCurrent();
    }catch(error){assertCurrent();throw error}
    /** @type {unknown} */ let data;
    try{data=body?JSON.parse(body):null}catch{invalid('JSON')}
    if(!response.ok){
      const message=object(data)&&typeof data.message==='string'?data.message:'סנכרון הגיליון נכשל';
      throw Object.assign(new Error(message),{code:object(data)?data.code:undefined,status:response.status});
    }
    return data;
  }
  /** @param {Record<string,unknown>} value @returns {SpreadsheetDocument<State>} */
  function decodeDocument(value){
    const version=revision(value.revision,0),state=decodeState(value.state);
    return {revision:version,state,...(value.updated_at===undefined?{}:{updated_at:timestamp(value.updated_at)})};
  }
  const query=`/rest/v1/spreadsheet_documents?domain=eq.${domain}&document_name=eq.main&select=`;
  async function readDocument(){const value=row(await api(query+'revision,state,updated_at'),true);return value?decodeDocument(value):null}
  async function readRevision(){const value=row(await api(query+'revision'),true);return value?{revision:revision(value.revision,0)}:null}
  /** @param {unknown} flight @param {State} base @returns {Promise<SpreadsheetAck<State>>} */
  async function write(flight,base){
    if(!object(flight)||!object(flight.payload))invalid('flight');
    const payload=flight.payload,expected=revision(payload.p_expected_revision,0);
    if(payload.p_domain!==domain||payload.p_document_name!=='main'||typeof payload.p_operation_id!=='string'||!payload.p_operation_id.trim()||payload.p_operation_id.length>200||flight.restore!==undefined&&typeof flight.restore!=='boolean')invalid('flight scope');
    const restore=flight.restore===true;
    const sentState=decodeState(flight.state);
    if(restore)revision(payload.p_backup_id);
    else if(!equalState(decodeState(payload.p_state),sentState))invalid('flight state');
    const value=row(await api('/rest/v1/rpc/'+(restore?'restore_spreadsheet_document_v1':'save_spreadsheet_document_v1'),{method:'POST',body:JSON.stringify(payload)}),false);
    if(!value||typeof value.operation_replayed!=='boolean')invalid('replay');
    const result=decodeDocument(value),replayed=value.operation_replayed;
    const minimum=restore?expected:expected+(!equalState(base,sentState)?1:0);
    if(!Number.isSafeInteger(minimum)||result.revision<minimum)invalid('revision regression');
    if(replayed&&!restore&&result.revision===minimum&&!equalState(result.state,sentState))invalid('replayed state');
    if(replayed&&restore&&result.revision===expected&&!equalState(result.state,base))invalid('replayed restore state');
    if(!replayed){
      // SQL returns the exact submitted state for a fresh save. An identical
      // state is a valid no-op; replay can instead return a later current head.
      if(!restore&&!equalState(result.state,sentState))invalid('accepted state');
      const accepted=expected+(!equalState(base,result.state)?1:0);
      // The schema permits an existing revision-zero document. A no-op on it
      // returns zero; creating the same state in an absent document returns one.
      const zeroCreation=expected===0&&accepted===0&&result.revision===1;
      if(!Number.isSafeInteger(accepted)||result.revision!==accepted&&!zeroCreation)invalid('accepted revision');
    }
    return {...result,operation_replayed:replayed};
  }
  /** @returns {Promise<SpreadsheetBackup[]>} */
  async function backups(){
    const data=await api(`/rest/v1/spreadsheet_backups?domain=eq.${domain}&document_name=eq.main&select=id,revision,created_at,kind&order=created_at.desc&limit=40`,{method:'GET'});
    if(!Array.isArray(data)||data.length>40)invalid('backup catalog');
    const seen=new Set();
    return data.map(value=>{
      if(!object(value))invalid('backup');
      const id=revision(value.id),version=revision(value.revision,0),created_at=timestamp(value.created_at),kind=value.kind;
      if(seen.has(id)||typeof kind!=='string'||!['edit','delete','bulk-delete','restore','migration'].includes(kind))invalid('backup');
      seen.add(id);return {id,revision:version,created_at,kind};
    });
  }
  return {readDocument,readRevision,write,backups};
}
