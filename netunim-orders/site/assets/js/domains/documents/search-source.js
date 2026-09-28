import {isAndroidDocumentSearch} from './google-drive.js';

const LOCAL_FALLBACK_CODES=new Set([
  'DOCUMENT_BRIDGE_NOT_PAIRED','DOCUMENT_BRIDGE_UNAVAILABLE','DOCUMENT_BRIDGE_UPGRADE_REQUIRED','UNAUTHORIZED',
  'EVERYTHING_EXE_NOT_FOUND','EVERYTHING_NOT_RUNNING','EVERYTHING_UNAVAILABLE','EVERYTHING_START_TIMEOUT','WINDOWS_REQUIRED',
]);
const SOURCE_PREFIX=Object.freeze({local:'local:',drive:'drive:'});
function sourceName(source){return source==='drive'?'google-drive':'everything'}
function sourceLabel(source){return source==='drive'?'Google Drive':'Everything'}
function prefixId(id,source){const raw=String(id||'');if(!raw)return '';const prefix=SOURCE_PREFIX[source];return raw.startsWith(prefix)?raw:`${prefix}${raw}`}
function decodeId(id){const raw=String(id||'');if(raw.startsWith(SOURCE_PREFIX.drive))return {source:'drive',id:raw.slice(SOURCE_PREFIX.drive.length)};if(raw.startsWith(SOURCE_PREFIX.local))return {source:'local',id:raw.slice(SOURCE_PREFIX.local.length)};return {source:'',id:raw}}
function normalizeRows(rows,source){return (Array.isArray(rows)?rows:[]).map(row=>({...row,id:prefixId(row?.id,source),sourceProvider:sourceName(source)}))}
function localFallbackError(error){return LOCAL_FALLBACK_CODES.has(String(error?.code||''))}

export function createDomainsDocumentSearch({localBridge,googleDrive,userAgent=globalThis.navigator?.userAgent||''}={}){
  const android=isAndroidDocumentSearch(userAgent);
  if(android&&!googleDrive)throw new Error('Google Drive document search source is missing');
  if(!android&&!localBridge&&!googleDrive)throw new Error('Document search source is missing');
  let active=android||!localBridge?'drive':'local',fallbackReason='';
  const provider=source=>source==='drive'?googleDrive:localBridge;
  function mark(source,reason=''){active=source;fallbackReason=source==='drive'&&!android?String(reason||fallbackReason||'הגישה המקומית אינה זמינה במחשב זה.') : '';return provider(source)}
  function providerFor(id){const decoded=decodeId(id);return decoded.source?sourceName(decoded.source):sourceName(active)}
  function providerNotice(){return active==='drive'&&!android&&fallbackReason?'מחובר דרך Google Drive כי הגישה המקומית אינה זמינה.':''}
  function getToken(){if(android||!localBridge)return googleDrive?.getToken?.()||'';return localBridge.getToken?.()||googleDrive?.getToken?.()||''}
  function setToken(value){return localBridge?.setToken?.(value)||''}
  function clearToken(){localBridge?.setToken?.('');googleDrive?.clearToken?.()}
  async function callDrive(method,args=[]){if(!googleDrive?.[method])throw new Error(`Google Drive does not support ${method}`);mark('drive');return googleDrive[method](...args)}
  async function withFallback(method,args=[],{rows=false}={}){
    if(android||!localBridge){const data=await callDrive(method,args);return rows?{...data,results:normalizeRows(data?.results,'drive')}:data}
    try{
      if(!localBridge?.[method])throw Object.assign(new Error(`Local bridge does not support ${method}`),{code:'DOCUMENT_BRIDGE_UNAVAILABLE'});
      const data=await localBridge[method](...args);mark('local');return rows?{...data,results:normalizeRows(data?.results,'local')}:data;
    }catch(error){
      if(String(error?.code||'')==='DOCUMENT_BRIDGE_ABORTED')throw error;
      if(!localFallbackError(error)||!googleDrive)throw error;
      if(String(error?.code||'')==='UNAUTHORIZED')localBridge.setToken?.('');
      const reason=String(error?.message||'הגישה המקומית אינה זמינה במחשב זה.');mark('drive',reason);
      try{const data=await googleDrive[method](...args);return rows?{...data,results:normalizeRows(data?.results,'drive')}:data}catch(driveError){mark('drive',reason);throw driveError}
    }
  }
  async function routed(method,id,...args){const decoded=decodeId(id),source=decoded.source||active,target=provider(source);if(!target?.[method]){const error=new Error(source==='drive'?'הפעולה אינה זמינה לקובץ Google Drive.':'הפעולה המקומית אינה זמינה.');error.code='DOCUMENT_ACTION_UNAVAILABLE';throw error}mark(source,source==='drive'?fallbackReason:'');return target[method](decoded.id,...args)}
  async function status(){return withFallback('status')}
  async function localStatus(){if(!localBridge?.status)throw Object.assign(new Error('Document Bridge אינו זמין במחשב זה.'),{code:'DOCUMENT_BRIDGE_UNAVAILABLE'});const data=await localBridge.status();mark('local');return data}
  async function warm(){return withFallback('warm')}
  async function recent(options){return withFallback('recent',[options],{rows:true})}
  async function search(query,options){return withFallback('search',[query,options],{rows:true})}
  async function preview(id){return routed('preview',id)}
  async function previewFile(id,options){return routed('previewFile',id,options)}
  async function matches(id,options){const decoded=decodeId(id),source=decoded.source||active;if(source==='drive')return {ok:true,active:false,query:'',count:0,snippets:[],source:'google-drive-viewer'};return routed('matches',id,options)}
  async function openDocument(id){return routed('openDocument',id)}
  async function revealDocument(id){return routed('revealDocument',id)}
  async function deleteDocument(id){const decoded=decodeId(id),source=decoded.source||active,target=provider(source);if(!target?.deleteDocument){const error=new Error(source==='drive'?'הפעולה אינה זמינה לקובץ Google Drive.':'הפעולה המקומית אינה זמינה.');error.code='DOCUMENT_ACTION_UNAVAILABLE';throw error}mark(source,source==='drive'?fallbackReason:'');const result=await target.deleteDocument(decoded.id);return {...result,invalidatedIds:(Array.isArray(result?.invalidatedIds)?result.invalidatedIds:[decoded.id]).map(value=>prefixId(value,source))}}
  async function nativePreview(id,geometry){return routed('nativePreview',id,geometry)}
  async function moveNativePreview(geometry){if(active!=='local'||!localBridge?.moveNativePreview)return false;return localBridge.moveNativePreview(geometry)}
  async function hideNativePreview(){if(!localBridge?.hideNativePreview)return false;return localBridge.hideNativePreview()}
  async function beginConnect(options){if(!googleDrive?.beginConnect)throw new Error('Google Drive connection is unavailable');mark('drive',fallbackReason);return googleDrive.beginConnect(options)}
  async function disconnect(){return googleDrive?.disconnect?.()}
  return {
    get provider(){return sourceName(active)},get providerLabel(){return sourceLabel(active)},get authKind(){return active==='drive'?'oauth':'local-token'},get fallbackFromLocal(){return active==='drive'&&!android},get providerNotice(){return providerNotice()},get supportsLocalPairing(){return !android&&!!localBridge},
    oauthReturn:googleDrive?.oauthReturn||{status:'',code:''},getToken,setToken,clearToken,beginConnect,disconnect,status,localStatus,warm,recent,search,preview,previewFile,matches,openDocument,revealDocument,deleteDocument,nativePreview,moveNativePreview,hideNativePreview,providerFor,
  };
}
