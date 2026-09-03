const BRIDGE_URL='http://127.0.0.1:8765';
const TOKEN_KEY='netunim_kupa_bank_bridge_token_v1';
const AUTO_KEY='netunim_kupa_bank_auto_daily_v1';
const AUTO_ATTEMPT_KEY='netunim_kupa_bank_auto_attempt_v1';
export const BANK_AUTO_INTERVAL_MS=4*60*60*1000;
export const INTERACTIVE_BRIDGE_TIMEOUT_MS=15*60*1000;
const AUTO_RETRY_COOLDOWN_MS=60*60*1000;

export function bankAutoRefreshDue(updatedAt,now=Date.now()){
  const t=updatedAt?Date.parse(updatedAt):NaN;
  return !Number.isFinite(t)||now-t>=BANK_AUTO_INTERVAL_MS;
}

function bridgeError(message,code='BRIDGE_ERROR',stage='',extra={}){
  const e=new Error(message);e.code=code;e.stage=stage;
  e.httpStatus=Number(extra?.httpStatus)||0;
  e.availableAccounts=Array.isArray(extra?.availableAccounts)?extra.availableAccounts:[];
  e.accountRole=extra?.accountRole==='home'?'home':extra?.accountRole==='business'?'business':'';
  e.creditErrors=Array.isArray(extra?.creditErrors)?extra.creditErrors:[];
  return e;
}

export function createDomainsBankBridge(){
function getBridgeToken(){return localStorage.getItem(TOKEN_KEY)||''}
function setBridgeToken(value){const token=String(value||'').trim();if(token)localStorage.setItem(TOKEN_KEY,token);else localStorage.removeItem(TOKEN_KEY);return token}
function autoEnabled(){return localStorage.getItem(AUTO_KEY)!=='0'}
function setAutoEnabled(enabled){localStorage.setItem(AUTO_KEY,enabled?'1':'0')}
function markAutoAttempt(now=Date.now()){localStorage.setItem(AUTO_ATTEMPT_KEY,String(now))}
function autoAttemptDelayMs(now=Date.now()){const last=Number(localStorage.getItem(AUTO_ATTEMPT_KEY)||0);return last?Math.max(0,last+AUTO_RETRY_COOLDOWN_MS-now):0}
function autoAttemptReady(now=Date.now()){return autoAttemptDelayMs(now)===0}

async function request(path,{method='GET',body=null,timeoutMs=5000}={}){
  const token=getBridgeToken();
  if(!token)throw bridgeError('חסר מפתח Bank Bridge. יש להזין את המפתח שמופיע בהתקנת החיבור המקומי.','BRIDGE_NOT_PAIRED');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const r=await fetch(BRIDGE_URL+path,{method,headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:controller.signal,cache:'no-store'});
    const text=await r.text();let data={};
    try{data=text?JSON.parse(text):{}}catch{}
    if(!r.ok||data.ok===false)throw bridgeError(data.message||`Bank Bridge החזיר שגיאה (${r.status})`,data.code||`HTTP_${r.status}`,data.stage||'',{httpStatus:data.httpStatus,availableAccounts:data.availableAccounts,accountRole:data.accountRole,creditErrors:data.creditErrors});
    return data;
  }catch(e){
    if(e?.name==='AbortError')throw bridgeError('Bank Bridge לא הגיב בזמן. ודא שהוא פועל במחשב ונסה שוב.','BRIDGE_TIMEOUT');
    if(e?.code)throw e;
    throw bridgeError('לא ניתן להתחבר ל-Bank Bridge המקומי. הפעל את start_bank_bridge.bat ונסה שוב.','BRIDGE_UNAVAILABLE');
  }finally{clearTimeout(timer)}
}

async function status(){return request('/status',{timeoutMs:3500})}
async function configureCredentials({token,userCode,password,businessBranchNumber,businessAccountNumber,homeBranchNumber,homeAccountNumber}){
  if(token)setBridgeToken(token);
  return request('/credentials',{method:'POST',body:{userCode,password,businessBranchNumber,businessAccountNumber,homeBranchNumber,homeAccountNumber},timeoutMs:10000});
}
async function selectAccount({role='business',branchNumber,accountNumber}){return request('/account-selection',{method:'POST',body:{role,branchNumber,accountNumber},timeoutMs:10000})}
async function deleteCredentials(){return request('/credentials',{method:'DELETE',timeoutMs:10000})}
async function fetchBalance({interactive=false,historyDays=30}={}){return request('/balance',{method:'POST',body:{interactive:!!interactive,historyDays:Math.max(30,Math.min(365,Number(historyDays)||30))},timeoutMs:interactive?INTERACTIVE_BRIDGE_TIMEOUT_MS:240000})}

async function creditRequest(path,options){
  try{return await request(`/v2/credit${path}`,options)}catch(error){
    if(!['HTTP_404','NOT_FOUND'].includes(String(error?.code||'')))throw error;
    const legacy=await request(`/credit${path}`,options);return {...legacy,rollbackMode:true};
  }
}
async function creditStatus(){return creditRequest('/status',{timeoutMs:5000})}
async function saveCreditProfile(profile){return creditRequest('/profiles',{method:'POST',body:profile,timeoutMs:15000})}
async function deleteCreditProfile(profileId){return creditRequest('/profiles',{method:'DELETE',body:{profileId},timeoutMs:15000})}
async function resetCreditProfiles(){return creditRequest('/reset',{method:'POST',body:{},timeoutMs:15000})}
async function creditDiagnostics(){return creditRequest('/diagnostics',{timeoutMs:5000})}
async function syncCreditCards({interactive=false}={}){return creditRequest('/sync',{method:'POST',body:{interactive:!!interactive},timeoutMs:INTERACTIVE_BRIDGE_TIMEOUT_MS})}

return {getBridgeToken,setBridgeToken,autoEnabled,setAutoEnabled,markAutoAttempt,autoAttemptDelayMs,autoAttemptReady,status,configureCredentials,selectAccount,deleteCredentials,fetchBalance,creditStatus,saveCreditProfile,deleteCreditProfile,resetCreditProfiles,creditDiagnostics,syncCreditCards};
}
