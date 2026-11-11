import {normalizeCreditFetchMode} from './credit-sync-policy.js';

const BRIDGE_URL='http://127.0.0.1:8765';
export const INTERACTIVE_BRIDGE_TIMEOUT_MS=15*60*1000;
const DEFAULT_MESSAGES={
  notPaired:'חסר מפתח Bank Bridge במחשב זה.',
  timeout:'Bank Bridge לא הגיב בזמן.',
  unavailable:'לא ניתן להתחבר ל-Bank Bridge המקומי.',
  imageNotPaired:'חסר מפתח Bank Bridge במחשב זה.',
};

function bridgeError(message,code='BRIDGE_ERROR',stage='',extra={}){
  const error=new Error(message);error.code=code;error.stage=stage;
  error.httpStatus=Number(extra.httpStatus)||0;
  error.availableAccounts=Array.isArray(extra.availableAccounts)?extra.availableAccounts:[];
  error.accountRole=['home','business'].includes(extra.accountRole)?extra.accountRole:'';
  error.creditErrors=Array.isArray(extra.creditErrors)?extra.creditErrors:[];
  return error;
}

function parseRecord(text){
  let data;
  try{data=JSON.parse(text)}catch{return null}
  return data!==null&&typeof data==='object'&&!Array.isArray(data)?data:null;
}

function invalidResponse(){
  return bridgeError('Bank Bridge החזיר תשובה לא תקינה','BRIDGE_RESPONSE_INVALID');
}

async function readProgressResponse(response,onProgress){
  if(!response.body)throw invalidResponse();
  const reader=response.body.pipeThrough(new TextDecoderStream()).getReader();
  let pending='';
  try{
    for(;;){
      const {value,done}=await reader.read();
      if(done)throw invalidResponse();
      const lines=value.split('\n');
      pending+=lines[0];
      for(let index=1;index<lines.length;index++){
        const frame=parseRecord(pending);
        pending=lines[index];
        if(!frame)throw invalidResponse();
        if(frame.result&&typeof frame.result.ok==='boolean'&&!Array.isArray(frame.result))return frame.result;
        if(!frame.progress||typeof frame.progress.stage!=='string')throw invalidResponse();
        // An observer can retire with its tab or account during the request.
        try{onProgress(frame.progress)}catch{}
      }
    }
  }finally{
    await reader.cancel().catch(()=>{});
    reader.releaseLock();
  }
}

// One local protocol implementation. The caller supplies browser/network/token
// ports; this module has no storage globals, scheduling globals or startup I/O.
export function createBankBridgeClient({tokenStore,fetchRequest,timers,createAbortController,messages={}}){
  if([tokenStore?.get,tokenStore?.set,fetchRequest,timers?.setTimeout,timers?.clearTimeout,createAbortController].some(port=>typeof port!=='function'))throw new Error('bank_bridge_ports_required');
  const text={...DEFAULT_MESSAGES,...messages};
  async function withResponse(path,{method='GET',body=null,timeoutMs=5000,image=false}={},consume){
    const token=tokenStore.get();
    if(!token)throw bridgeError(image?text.imageNotPaired:text.notPaired,'BRIDGE_NOT_PAIRED');
    const controller=createAbortController(),timer=timers.setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const response=await fetchRequest(BRIDGE_URL+path,{method,
        headers:{Authorization:`Bearer ${token}`,...(image?{Accept:'image/*'}:{}),...(body?{'Content-Type':'application/json'}:{})},
        body:body?JSON.stringify(body):undefined,signal:controller.signal,cache:'no-store',redirect:'error'});
      return await consume(response);
    }catch(error){
      if(error?.name==='AbortError')throw bridgeError(image?'טעינת תמונת השיק מה-Bank Bridge לא הגיבה בזמן':text.timeout,'BRIDGE_TIMEOUT');
      if(error?.code)throw error;
      throw bridgeError(image?'לא ניתן לטעון את תמונת השיק מה-Bank Bridge המקומי':text.unavailable,'BRIDGE_UNAVAILABLE');
    }finally{timers.clearTimeout(timer)}
  }
  async function request(path,options){
    return withResponse(path,options,async response=>{
      const streamed=typeof options?.onProgress==='function'&&response.ok&&
        response.headers?.get('Content-Type')?.split(';')[0].trim()==='application/x-ndjson';
      let data=streamed?await readProgressResponse(response,options.onProgress):parseRecord(await response.text());
      if(!data){
        // An unsuccessful HTTP response keeps its transport code even if a
        // proxy supplied HTML. A successful response must satisfy the protocol.
        if(response.ok)throw invalidResponse();
        data={};
      }
      if(!response.ok||data.ok===false){
        const error=bridgeError(data.message||`Bank Bridge החזיר שגיאה (${response.status})`,data.code||`HTTP_${response.status}`,data.stage||'',data);
        // Installed older servers use this exact pre-dispatch route response.
        // A provider's NOT_FOUND or an ambiguous proxy 404 cannot authorize replay.
        error.routeNotFound=!streamed&&response.status===404&&data.ok===false&&data.code==='NOT_FOUND'&&
          data.message==='נתיב Bank Bridge לא קיים'&&!data.stage;
        if(streamed)error.streamed=true;
        throw error;
      }
      return data;
    });
  }
  async function fetchChequeImage(imageKey){
    const key=String(imageKey||'').trim().toLowerCase();if(!/^[a-f0-9]{64}$/.test(key))return null;
    return withResponse(`/bank/cheque-image/${key}`,{timeoutMs:30000,image:true},async response=>{
      if(response.status===404)return null;
      if(!response.ok){let data={};try{data=await response.json()}catch{}throw bridgeError(data?.message||`טעינת תמונת שיק מה-Bridge נכשלה (${response.status})`,data?.code||`HTTP_${response.status}`)}
      const blob=await response.blob();
      if(!blob.size||blob.size>5*1024*1024||!/^image\/(?:jpeg|png|webp|gif|bmp)$/i.test(blob.type))throw bridgeError('Bank Bridge החזיר קובץ תמונת שיק לא תקין','CHEQUE_IMAGE_INVALID');
      return blob;
    });
  }
  async function creditRequest(path,options){
    try{return await request(`/v2/credit${path}`,options)}catch(error){
      if(error?.streamed||error?.routeNotFound!==true)throw error;
      const legacy=await request(`/credit${path}`,options);return {...legacy,rollbackMode:true};
    }
  }
  function configureCredentials({token,userCode,password,businessBranchNumber,businessAccountNumber,homeBranchNumber,homeAccountNumber}){
    if(token)tokenStore.set(token);
    return request('/credentials',{method:'POST',body:{userCode,password,businessBranchNumber,businessAccountNumber,homeBranchNumber,homeAccountNumber},timeoutMs:10000});
  }
  function selectAccount({role='business',branchNumber,accountNumber}){return request('/account-selection',{method:'POST',body:{role,branchNumber,accountNumber},timeoutMs:10000})}
  function fetchBalance({interactive=false,historyDays=30,onProgress}={}){
    const body={interactive:!!interactive,historyDays:Math.max(30,Math.min(365,Number(historyDays)||30))};
    if(typeof onProgress==='function')body.streamProgress=true;
    return request('/balance',{method:'POST',body,onProgress,timeoutMs:interactive?INTERACTIVE_BRIDGE_TIMEOUT_MS:240000});
  }
  function syncCreditCards({interactive=false,syncMode='quick',selection=[],onProgress}={}){
    const mode=normalizeCreditFetchMode(syncMode);
    const options={
      method:'POST',body:{interactive:!!interactive,syncMode:mode,selection:Array.isArray(selection)?selection:[]},
      onProgress,timeoutMs:INTERACTIVE_BRIDGE_TIMEOUT_MS,
    };
    if(typeof onProgress==='function')options.body.streamProgress=true;
    return creditRequest('/sync',options);
  }
  return {
    getBridgeToken:()=>tokenStore.get(),setBridgeToken:value=>tokenStore.set(value),
    status:()=>request('/status',{timeoutMs:3500}),
    importConnectionSettings:payload=>request('/settings/import',{method:'POST',body:payload,timeoutMs:20000}),
    configureCredentials,selectAccount,fetchBalance,fetchChequeImage,
    deleteCredentials:()=>request('/credentials',{method:'DELETE',timeoutMs:10000}),
    bankDiagnostics:()=>request('/bank/diagnostics',{timeoutMs:10000}),
    creditStatus:()=>creditRequest('/status',{timeoutMs:5000}),
    saveCreditProfile:profile=>creditRequest('/profiles',{method:'POST',body:profile,timeoutMs:15000}),
    deleteCreditProfile:profileId=>creditRequest('/profiles',{method:'DELETE',body:{profileId},timeoutMs:15000}),
    resetCreditProfiles:()=>creditRequest('/reset',{method:'POST',body:{},timeoutMs:15000}),
    creditDiagnostics:()=>creditRequest('/diagnostics',{timeoutMs:5000}),
    creditDataDiagnostics:()=>creditRequest('/data-diagnostics',{timeoutMs:10000}),syncCreditCards,
  };
}
