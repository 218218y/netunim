import {BRIDGE_SERVICE,BRIDGE_VERSION} from './lib.mjs';

// Installer stop/check commands own their loopback client and process policy.
// They can never borrow the listener's accepted-work drain or start a provider.
export function createBridgeReplacementCommand({token,listener,processes,runtime}){
if(typeof token?.read!=='function'||typeof token.path!=='string'||!token.path||typeof listener?.request!=='function'||!Number.isSafeInteger(listener.port)||listener.port<1||listener.port>65535||typeof processes?.bridgeListenerPid!=='function'||typeof processes.forceStopProcessTree!=='function'||typeof processes.waitForProcessExit!=='function'||typeof runtime?.now!=='function'||typeof runtime.setTimeout!=='function'||typeof runtime.log!=='function')throw new TypeError('document_replacement_ports_required');
const TOKEN_PATH=token.path,fs={readFile:token.read},http={request:listener.request},BRIDGE_PORT=listener.port;
const {bridgeListenerPid,forceStopProcessTree,waitForProcessExit}=processes;
const appendLog=runtime.log,Date={now:runtime.now},setTimeout=runtime.setTimeout;
const SHUTDOWN_REQUEST_TIMEOUT_MS=120000;
function loopbackRequest(urlPath,{method='GET',token='',timeoutMs=2500}={}){
  return new Promise((resolve,reject)=>{
    const req=http.request({host:'127.0.0.1',port:BRIDGE_PORT,path:urlPath,method,headers:{Accept:'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},agent:false},res=>{
      let size=0;const chunks=[];res.on('data',chunk=>{size+=chunk.length;if(size<=65536)chunks.push(chunk)});res.on('end',()=>{let data={};try{data=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}')}catch{}resolve({statusCode:Number(res.statusCode)||0,data})});
    });
    req.setTimeout(timeoutMs,()=>req.destroy(Object.assign(new Error('Loopback request timed out'),{code:'ETIMEDOUT'})));req.on('error',reject);req.end();
  });
}
async function checkRunning(){const response=await loopbackRequest('/health',{timeoutMs:2500});if(response.statusCode!==200||response.data?.service!==BRIDGE_SERVICE||Number(response.data?.version)!==BRIDGE_VERSION){const e=new Error('Document Bridge health check failed.');e.code='HEALTHCHECK_FAILED';throw e}return response.data}




async function stopExisting(){
  let health;try{health=await loopbackRequest('/health',{timeoutMs:900})}catch(error){if(['ECONNREFUSED','ECONNRESET','ETIMEDOUT'].includes(String(error?.code)))return;throw error}
  if(health.statusCode!==200||health.data?.service!==BRIDGE_SERVICE){const e=new Error(`Port ${BRIDGE_PORT} is already in use by another service.`);e.code='PORT_IN_USE';throw e}
  const listenerPid=Number(health.data?.pid)||await bridgeListenerPid();
  let token='';try{token=(await fs.readFile(TOKEN_PATH,'utf8')).trim()}catch{}if(!token){const e=new Error('Existing Document Bridge is running but its local token is unavailable.');e.code='TOKEN_MISSING';throw e}
  const response=await loopbackRequest('/shutdown',{method:'POST',token,timeoutMs:SHUTDOWN_REQUEST_TIMEOUT_MS});if(response.statusCode!==200){const e=new Error(`Existing Document Bridge refused shutdown (HTTP ${response.statusCode}).`);e.code='SHUTDOWN_FAILED';throw e}
  const portDeadline=Date.now()+3500;let portClosed=false;while(Date.now()<portDeadline){await new Promise(r=>setTimeout(r,120));try{await loopbackRequest('/health',{timeoutMs:300})}catch(error){if(['ECONNREFUSED','ECONNRESET','ETIMEDOUT'].includes(String(error?.code))){portClosed=true;break}}}
  if(listenerPid&&!(await waitForProcessExit(listenerPid,1500))){await appendLog(`INSTALL_STOP_FORCE pid=${listenerPid} reason=${JSON.stringify(portClosed?'listener-closed-process-still-running':'shutdown-timeout')}`);await forceStopProcessTree(listenerPid);if(!(await waitForProcessExit(listenerPid,2500))){const e=new Error(`Existing Document Bridge process ${listenerPid} could not be terminated.`);e.code='SHUTDOWN_PROCESS_STUCK';throw e}}
  try{await loopbackRequest('/health',{timeoutMs:500});const e=new Error('Existing Document Bridge listener is still active after shutdown.');e.code='SHUTDOWN_TIMEOUT';throw e}catch(error){if(['ECONNREFUSED','ECONNRESET','ETIMEDOUT'].includes(String(error?.code)))return;throw error}
}
return {stopExisting,checkRunning};
}
