const BRIDGE_URL='http://127.0.0.1:8765';
const TOKEN_KEY='netunim_kupa_bank_bridge_token_v1';
const BANK_AUTO_KEY='netunim_orders_bank_auto_daily_v1';
const CREDIT_AUTO_KEY='netunim_orders_credit_auto_daily_v1';
const BANK_ATTEMPT_KEY='netunim_orders_bank_auto_attempt_v1';
const CREDIT_ATTEMPT_KEY='netunim_orders_credit_auto_attempt_v1';
export const BANK_AUTO_INTERVAL_MS=4*60*60*1000;
export const CREDIT_AUTO_INTERVAL_MS=24*60*60*1000;
const AUTO_RETRY_MS=60*60*1000;
const CREDIT_AUTO_RETRY_MS=24*60*60*1000;
const INTERACTIVE_TIMEOUT_MS=15*60*1000;

function bridgeError(message,code='BRIDGE_ERROR',stage='',extra={}){const e=new Error(message);e.code=code;e.stage=stage;e.httpStatus=Number(extra?.httpStatus)||0;e.availableAccounts=Array.isArray(extra?.availableAccounts)?extra.availableAccounts:[];e.accountRole=extra?.accountRole==='home'?'home':extra?.accountRole==='business'?'business':'';e.creditErrors=Array.isArray(extra?.creditErrors)?extra.creditErrors:[];return e}
function enabled(key){return localStorage.getItem(key)!=='0'}
function setEnabled(key,value){localStorage.setItem(key,value?'1':'0')}
function markAttempt(key,now=Date.now()){localStorage.setItem(key,String(now))}
function attemptDelayMs(key,now=Date.now(),retryMs=AUTO_RETRY_MS){const last=Number(localStorage.getItem(key)||0);return last?Math.max(0,last+retryMs-now):0}
function attemptReady(key,now=Date.now(),retryMs=AUTO_RETRY_MS){return attemptDelayMs(key,now,retryMs)===0}

function refreshDue(updatedAt,intervalMs,now=Date.now()){const t=updatedAt?Date.parse(updatedAt):NaN;return !Number.isFinite(t)||now-t>=intervalMs}
export function bankRefreshDue(updatedAt,now=Date.now()){return refreshDue(updatedAt,BANK_AUTO_INTERVAL_MS,now)}
export function creditRefreshDue(updatedAt,now=Date.now()){return refreshDue(updatedAt,CREDIT_AUTO_INTERVAL_MS,now)}

export function createDomainsFinanceBridge(){
function getBridgeToken(){return localStorage.getItem(TOKEN_KEY)||''}
function setBridgeToken(value){const token=String(value||'').trim();if(token)localStorage.setItem(TOKEN_KEY,token);else localStorage.removeItem(TOKEN_KEY);return token}
async function request(path,{method='GET',body=null,timeoutMs=5000}={}){const token=getBridgeToken();if(!token)throw bridgeError('חסר מפתח Bank Bridge במחשב זה.','BRIDGE_NOT_PAIRED');const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);try{const r=await fetch(BRIDGE_URL+path,{method,headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:controller.signal,cache:'no-store'});const text=await r.text();let data={};try{data=text?JSON.parse(text):{}}catch{}if(!r.ok||data.ok===false)throw bridgeError(data.message||`Bank Bridge החזיר שגיאה (${r.status})`,data.code||`HTTP_${r.status}`,data.stage||'',{httpStatus:data.httpStatus,availableAccounts:data.availableAccounts,accountRole:data.accountRole,creditErrors:data.creditErrors});return data}catch(e){if(e?.name==='AbortError')throw bridgeError('Bank Bridge לא הגיב בזמן.','BRIDGE_TIMEOUT');if(e?.code)throw e;throw bridgeError('לא ניתן להתחבר ל-Bank Bridge המקומי.','BRIDGE_UNAVAILABLE')}finally{clearTimeout(timer)}}
function bankAutoEnabled(){return enabled(BANK_AUTO_KEY)}
function creditAutoEnabled(){return enabled(CREDIT_AUTO_KEY)}
function setBankAutoEnabled(value){setEnabled(BANK_AUTO_KEY,!!value)}
function setCreditAutoEnabled(value){setEnabled(CREDIT_AUTO_KEY,!!value)}
function markBankAttempt(){markAttempt(BANK_ATTEMPT_KEY)}
function markCreditAttempt(){markAttempt(CREDIT_ATTEMPT_KEY)}
function bankAttemptDelayMs(){return attemptDelayMs(BANK_ATTEMPT_KEY)}
function creditAttemptDelayMs(){return attemptDelayMs(CREDIT_ATTEMPT_KEY,Date.now(),CREDIT_AUTO_RETRY_MS)}
function bankAttemptReady(){return attemptReady(BANK_ATTEMPT_KEY)}
function creditAttemptReady(){return attemptReady(CREDIT_ATTEMPT_KEY,Date.now(),CREDIT_AUTO_RETRY_MS)}
function status(){return request('/status',{timeoutMs:3500})}
function configureCredentials({token,userCode,password,businessBranchNumber,businessAccountNumber,homeBranchNumber,homeAccountNumber}){if(token)setBridgeToken(token);return request('/credentials',{method:'POST',body:{userCode,password,businessBranchNumber,businessAccountNumber,homeBranchNumber,homeAccountNumber},timeoutMs:10000})}
function selectAccount({role='business',branchNumber,accountNumber}){return request('/account-selection',{method:'POST',body:{role,branchNumber,accountNumber},timeoutMs:10000})}
function deleteCredentials(){return request('/credentials',{method:'DELETE',timeoutMs:10000})}
function fetchBalance({interactive=false,historyDays=30}={}){return request('/balance',{method:'POST',body:{interactive:!!interactive,historyDays:Math.max(30,Math.min(365,Number(historyDays)||30))},timeoutMs:interactive?INTERACTIVE_TIMEOUT_MS:240000})}
async function creditRequest(path,options){try{return await request(`/v2/credit${path}`,options)}catch(error){if(!['HTTP_404','NOT_FOUND'].includes(String(error?.code||'')))throw error;const legacy=await request(`/credit${path}`,options);return {...legacy,rollbackMode:true}}}
function creditStatus(){return creditRequest('/status',{timeoutMs:5000})}
function saveCreditProfile(profile){return creditRequest('/profiles',{method:'POST',body:profile,timeoutMs:15000})}
function deleteCreditProfile(profileId){return creditRequest('/profiles',{method:'DELETE',body:{profileId},timeoutMs:15000})}
function resetCreditProfiles(){return creditRequest('/reset',{method:'POST',body:{},timeoutMs:15000})}
function creditDiagnostics(){return creditRequest('/diagnostics',{timeoutMs:5000})}
function syncCreditCards({interactive=false,syncMode='daily'}={}){const mode=syncMode==='full'?'full':'daily';return creditRequest('/sync',{method:'POST',body:{interactive:!!interactive,syncMode:mode},timeoutMs:INTERACTIVE_TIMEOUT_MS})}
return {getBridgeToken,setBridgeToken,bankAutoEnabled,creditAutoEnabled,setBankAutoEnabled,setCreditAutoEnabled,markBankAttempt,markCreditAttempt,bankAttemptDelayMs,creditAttemptDelayMs,bankAttemptReady,creditAttemptReady,status,configureCredentials,selectAccount,deleteCredentials,fetchBalance,creditStatus,saveCreditProfile,deleteCreditProfile,resetCreditProfiles,creditDiagnostics,syncCreditCards};
}
