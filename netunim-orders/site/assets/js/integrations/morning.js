// @ts-check
/**
 * @typedef {import('../core/morning-operation-scope.js').MorningAssertion} MorningAssertion
 * @typedef {import('../core/morning-operation-scope.js').MorningOperationScope} MorningOperationScope
 * @typedef {Record<string,unknown>} MorningResult
 * @typedef {{method:'POST',networkRetry:false,dataPriority:'high',body:string,assertRequestScope:MorningAssertion}} MorningRequestOptions
 */
const PATH='/functions/v1/morning-documents';
/** @param {unknown} value @returns {value is MorningResult} */
function object(value){return value!==null&&typeof value==='object'&&!Array.isArray(value)}
/** @param {unknown} value */
function message(value){return value instanceof Error?value.message:'לא ניתן להגיע לשירות Morning'}
/** @param {{supaFetch:(path:string,options:MorningRequestOptions)=>Promise<Response>,operationScope:MorningOperationScope}} ports */
export function createMorningRequest({supaFetch,operationScope}){
  if(typeof supaFetch!=='function'||typeof operationScope?.captureRead!=='function')throw new TypeError('morning_request_ports_required');
  /** @param {string} action @param {MorningResult} payload @param {MorningAssertion} assertCurrent */
  async function response(action,payload,assertCurrent){
    assertCurrent();
    try{const result=await supaFetch(PATH,{method:'POST',networkRetry:false,dataPriority:'high',assertRequestScope:assertCurrent,body:JSON.stringify({action,...payload})});assertCurrent();return result}
    catch(error){assertCurrent();throw Object.assign(new Error(message(error)),{code:object(error)&&typeof error.code==='string'?error.code:'morning_backend_unreachable'})}
  }
  /** @param {Response} result @param {MorningAssertion} assertCurrent */
  async function body(result,assertCurrent){
    let data;try{data=await result.json()}catch(error){assertCurrent();throw Object.assign(new Error(message(error)),{code:'morning_response_invalid'})}
    assertCurrent();
    if(!object(data))throw Object.assign(new Error('שירות Morning החזיר תשובה שאינה תקינה'),{code:'morning_response_invalid'});
    if(!result.ok||data.ok===false)throw Object.assign(new Error(typeof data.message==='string'?data.message:'שירות Morning החזיר שגיאה'),{code:typeof data.code==='string'?data.code:'morning_backend_error',status:result.status,details:data});
    return data;
  }
  /** @param {string} action @param {MorningResult} [payload] @param {MorningAssertion} [assertCurrent] */
  async function json(action,payload={},assertCurrent=operationScope.captureRead()){return body(await response(action,payload,assertCurrent),assertCurrent)}
  /** @param {string} id @param {MorningAssertion} [assertCurrent] */
  async function pdf(id,assertCurrent=operationScope.captureRead()){
    const result=await response('document_pdf',{document_id:id},assertCurrent);
    if(!result.ok)await body(result,assertCurrent);
    if(!String(result.headers.get('Content-Type')||'').toLowerCase().includes('application/pdf'))throw new Error('Morning החזירה קובץ שאינו PDF');
    const blob=await result.blob();assertCurrent();if(!blob.size)throw new Error('Morning החזירה קובץ PDF ריק');return blob;
  }
  return {json,pdf};
}
