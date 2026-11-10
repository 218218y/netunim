import {BRIDGE_SERVICE,BRIDGE_VERSION,originAllowed} from './lib.mjs';

// Installer stop/check commands own their loopback client and process policy.
// They can never borrow the listener's accepted-work drain or start a provider.
export function createBridgeReplacementCommand({token,listener,processes,runtime}){
if(typeof token?.read!=='function'||typeof token.path!=='string'||!token.path||typeof listener?.request!=='function'||typeof listener.allowedOrigins!=='function'||!Number.isSafeInteger(listener.port)||listener.port<1||listener.port>65535||typeof processes?.bridgeListenerPid!=='function'||typeof processes.forceStopProcessTree!=='function'||typeof processes.waitForProcessExit!=='function'||typeof runtime?.now!=='function'||typeof runtime.setTimeout!=='function'||typeof runtime.log!=='function')throw new TypeError('document_replacement_ports_required');
const TOKEN_PATH=token.path,fs={readFile:token.read},http={request:listener.request},BRIDGE_PORT=listener.port;
const {bridgeListenerPid,forceStopProcessTree,waitForProcessExit}=processes;
const appendLog=runtime.log,Date={now:runtime.now},setTimeout=runtime.setTimeout;
const SHUTDOWN_REQUEST_TIMEOUT_MS=120000;
function loopbackRequest(urlPath,{method='GET',token='',timeoutMs=2500,headers={}}={}){
  return new Promise((resolve,reject)=>{
    const req=http.request({host:'127.0.0.1',port:BRIDGE_PORT,path:urlPath,method,headers:{Accept:'application/json',...headers,...(token?{Authorization:`Bearer ${token}`}:{})},agent:false},res=>{
      let size=0;const chunks=[];res.on('error',reject);res.on('data',chunk=>{size+=chunk.length;if(size<=65536)chunks.push(chunk)});res.on('end',()=>{let data={};try{data=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}')}catch{}resolve({statusCode:Number(res.statusCode)||0,data,headers:res.headers})});
    });
    req.setTimeout(timeoutMs,()=>req.destroy(Object.assign(new Error('Loopback request timed out'),{code:'ETIMEDOUT'})));req.on('error',reject);req.end();
  });
}
async function checkRunning(){
  if(!listener.installationId){const e=new Error('The staged Document Bridge installation ID is missing or invalid. Rerun the installer.');e.code='INSTALLATION_ID_MISSING';throw e}
  const response=await loopbackRequest('/health',{timeoutMs:2500});
  const sameService=health=>health.statusCode===200&&health.data?.ok===true&&health.data.service===BRIDGE_SERVICE&&health.data.version===BRIDGE_VERSION;
  const sameInstallation=health=>health.data?.pairingProtocol===1&&health.data.installationId===listener.installationId;
  if(!sameService(response)){const e=new Error('The expected Document Bridge service/version did not respond on the local port.');e.code='HEALTHCHECK_FAILED';throw e}
  if(!sameInstallation(response)){const e=new Error('The running Document Bridge does not match this installation or lacks scoped pairing. An older instance may still be running.');e.code='INSTALLATION_MISMATCH';throw e}
  const configured=await listener.allowedOrigins();
  const origins=[...new Set((Array.isArray(configured)?configured:[]).filter(origin=>typeof origin==='string'&&origin&&!origin.includes('*')&&originAllowed(origin,[origin])))];
  if(!origins.length){const e=new Error('Document Bridge has no exact website Origins configured. Review allowedOrigins in config.json.');e.code='ORIGIN_CONFIGURATION_INVALID';throw e}
  for(const origin of origins){
    const preflight=await loopbackRequest('/documents/search',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,content-type','Access-Control-Request-Private-Network':'true'}});
    const headers=preflight.headers||{},includes=(name,value)=>String(headers[name]||'').toLowerCase().split(',').map(part=>part.trim()).includes(value);
    const health=await loopbackRequest('/health',{headers:{Origin:origin}});
    if(preflight.statusCode!==204||headers['access-control-allow-origin']!==origin||!includes('access-control-allow-methods','post')||!includes('access-control-allow-headers','authorization')||!includes('access-control-allow-headers','content-type')||headers['access-control-allow-private-network']!=='true'||health.headers?.['access-control-allow-origin']!==origin||!sameService(health)||!sameInstallation(health)){
      const e=new Error(`Document Bridge browser access check failed for ${origin}. Review allowedOrigins in config.json and reinstall the current Bridge.`);e.code='ORIGIN_PREFLIGHT_FAILED';throw e;
    }
  }
  return response.data;
}




async function stopExisting(){
  let health;try{health=await loopbackRequest('/health',{timeoutMs:900})}catch(error){if(error?.code==='ECONNREFUSED')return;throw error}
  if(health.statusCode!==200||health.data?.service!==BRIDGE_SERVICE){const e=new Error(`Port ${BRIDGE_PORT} is already in use by another service.`);e.code='PORT_IN_USE';throw e}
  const listenerPid=Number(health.data?.pid)||await bridgeListenerPid();
  let credential='';try{credential=(health.data?.pairingProtocol===1?await token.readAdmin():await fs.readFile(TOKEN_PATH,'utf8')).trim()}catch{}if(!credential){const e=new Error('Existing Document Bridge is running but its local token is unavailable.');e.code='TOKEN_MISSING';throw e}
  const response=await loopbackRequest('/shutdown',{method:'POST',token:credential,timeoutMs:SHUTDOWN_REQUEST_TIMEOUT_MS});if(response.statusCode!==200){const e=new Error(`Existing Document Bridge refused shutdown (HTTP ${response.statusCode}).`);e.code='SHUTDOWN_FAILED';throw e}
  const portDeadline=Date.now()+3500;let portClosed=false;while(Date.now()<portDeadline){await new Promise(r=>setTimeout(r,120));try{await loopbackRequest('/health',{timeoutMs:300})}catch(error){if(error?.code==='ECONNREFUSED'){portClosed=true;break}}}
  if(listenerPid&&!(await waitForProcessExit(listenerPid,1500))){await appendLog(`INSTALL_STOP_FORCE pid=${listenerPid} reason=${JSON.stringify(portClosed?'listener-closed-process-still-running':'shutdown-timeout')}`);await forceStopProcessTree(listenerPid);if(!(await waitForProcessExit(listenerPid,2500))){const e=new Error(`Existing Document Bridge process ${listenerPid} could not be terminated.`);e.code='SHUTDOWN_PROCESS_STUCK';throw e}}
  try{await loopbackRequest('/health',{timeoutMs:500});const e=new Error('Existing Document Bridge listener is still active after shutdown.');e.code='SHUTDOWN_TIMEOUT';throw e}catch(error){if(error?.code==='ECONNREFUSED')return;throw error}
}
return {stopExisting,checkRunning};
}
