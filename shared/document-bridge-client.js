const BRIDGE_URL='http://127.0.0.1:8766';
const REQUEST_TIMEOUT_MS=25000;
const EXPECTED_BRIDGE_VERSION=38;

function bridgeError(message,code='DOCUMENT_BRIDGE_ERROR',extra={}){const error=new Error(message);error.code=code;error.httpStatus=Number(extra?.httpStatus)||0;error.rootErrors=Array.isArray(extra?.rootErrors)?extra.rootErrors:[];return error}
function requireBridgeVersion(value,purpose='לטעון את גרסת החיפוש הנכונה'){const version=Number(value)||0;if(version!==EXPECTED_BRIDGE_VERSION)throw bridgeError(`Document Bridge פעיל בגרסה ${version||'ישנה'} במקום ${EXPECTED_BRIDGE_VERSION}. הרץ מחדש את install_document_bridge.bat כדי ${purpose}.`,'DOCUMENT_BRIDGE_UPGRADE_REQUIRED')}

// One local protocol owner. Pairing storage, network and scheduling are supplied
// through ports; the first cancellation cause owns the request's outcome.
export function createDocumentBridgeClient({tokenStore,fetchRequest,timers,createAbortController}){
  if([tokenStore?.get,tokenStore?.set,fetchRequest,timers?.setTimeout,timers?.clearTimeout,createAbortController].some(port=>typeof port!=='function'))throw new Error('document_bridge_ports_required');
  const getToken=()=>tokenStore.get(),setToken=value=>tokenStore.set(value);
  function cancelled(preview=false,timedOut=false){return bridgeError(timedOut?'Document Bridge לא הגיב בזמן.':preview?'התצוגה הקודמת בוטלה.':'החיפוש הקודם בוטל.',timedOut?'DOCUMENT_BRIDGE_TIMEOUT':'DOCUMENT_BRIDGE_ABORTED')}
  async function withResponse(path,{method='GET',body=null,timeoutMs=REQUEST_TIMEOUT_MS,signal=null,auth=true,preview=false}={},consume){
    // A signal is one-shot: registering a listener after abort does not replay it.
    if(signal?.aborted)throw cancelled(preview);
    const token=auth?getToken():'';
    if(auth&&!token)throw bridgeError('חסר מפתח Document Bridge במחשב זה.','DOCUMENT_BRIDGE_NOT_PAIRED');
    const controller=createAbortController();let timer=null,abortCause=null;
    function abort(cause){if(abortCause===null)abortCause=cause;controller.abort()}
    const onAbort=()=>abort('caller');
    function assertActive(){if(signal?.aborted&&abortCause===null)abort('caller');if(controller.signal.aborted)throw cancelled(preview,abortCause==='deadline')}
    try{
      signal?.addEventListener?.('abort',onAbort,{once:true});
      assertActive();
      timer=timers.setTimeout(()=>abort('deadline'),timeoutMs);
      const response=await fetchRequest(BRIDGE_URL+path,{method,headers:{...(auth?{Authorization:`Bearer ${token}`}:{Accept:'application/json'}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:controller.signal,cache:'no-store',redirect:'error'});
      assertActive();
      const result=await consume(response);assertActive();return result;
    }catch(error){
      if(signal?.aborted||controller.signal.aborted||error?.name==='AbortError')throw cancelled(preview,abortCause==='deadline');
      if(error?.code)throw error;
      throw bridgeError('לא ניתן להתחבר ל-Document Bridge במחשב זה.','DOCUMENT_BRIDGE_UNAVAILABLE');
    }finally{if(timer!==null)timers.clearTimeout(timer);signal?.removeEventListener?.('abort',onAbort)}
  }
  function parseObject(text){let data;try{data=JSON.parse(text)}catch{return null}return data!==null&&typeof data==='object'&&!Array.isArray(data)?data:null}
  function responseError(response,data={}){return bridgeError(data.message||`Document Bridge החזיר שגיאה (${response.status})`,data.code||`HTTP_${response.status}`,{httpStatus:response.status,rootErrors:data.rootErrors})}
  async function request(path,options){
    return withResponse(path,options,async response=>{
      const data=parseObject(await response.text());
      if(!data){if(!response.ok)throw responseError(response);throw bridgeError('Document Bridge החזיר תשובה לא תקינה.','DOCUMENT_BRIDGE_RESPONSE_INVALID',{httpStatus:response.status})}
      if(!response.ok||data.ok===false)throw responseError(response,data);
      return data;
    });
  }
  async function requestBlob(path,{body,timeoutMs=REQUEST_TIMEOUT_MS,signal=null}={}){
    return withResponse(path,{method:'POST',body:body||{},timeoutMs,signal,preview:true},async response=>{
      if(!response.ok){
        let data=null;try{data=parseObject(await response.text())}catch(error){if(error?.name==='AbortError')throw error}
        throw responseError(response,data||{});
      }
      return await response.blob();
    });
  }

  const health=()=>request('/health',{auth:false,timeoutMs:2500});
  const status=()=>request('/status',{timeoutMs:5000});
  const warm=()=>request('/documents/warm',{method:'POST',body:{},timeoutMs:8000});
  const pdfIndexRequest=async(path,options,purpose)=>{try{const data=await request(path,options);requireBridgeVersion(data?.bridgeVersion,purpose);return data}catch(error){if(error?.code==='NOT_FOUND'||error?.httpStatus===404)throw bridgeError('Document Bridge במחשב זה ישן. הרץ מחדש את install_document_bridge.bat כדי להשתמש ברענון ה-PDF.','DOCUMENT_BRIDGE_UPGRADE_REQUIRED');throw error}};
  const pdfIndexStatus=()=>pdfIndexRequest('/documents/pdf-index/status',{timeoutMs:5000},'להציג את מצב רענון ה-PDF');
  const startPdfIndex=()=>pdfIndexRequest('/documents/pdf-index/start',{method:'POST',body:{},timeoutMs:8000},'להפעיל רענון PDF ידני');
  const stopPdfIndex=()=>pdfIndexRequest('/documents/pdf-index/stop',{method:'POST',body:{},timeoutMs:8000},'לעצור רענון PDF ידני');
  const selectFolder=async()=>{try{const runtime=await health();requireBridgeVersion(runtime?.version,'לקבל את בורר התיקיות החדש של Windows');const data=await request('/documents/select-folder',{method:'POST',body:{},timeoutMs:125000});requireBridgeVersion(data?.bridgeVersion,'לקבל את בורר התיקיות החדש של Windows');return data}catch(error){if(error?.code==='NOT_FOUND'||error?.httpStatus===404)throw bridgeError('Document Bridge במחשב זה ישן. הרץ מחדש את install_document_bridge.bat מהגרסה המעודכנת.','DOCUMENT_BRIDGE_UPGRADE_REQUIRED');throw error}};
  const recent=async({limit=150,scopePath='',fileType='all',signal=null}={})=>{const data=await request('/documents/recent',{method:'POST',body:{limit,scopePath:String(scopePath||''),fileType:String(fileType||'all')},timeoutMs:REQUEST_TIMEOUT_MS,signal});requireBridgeVersion(data?.bridgeVersion,'להשתמש במסנן סוגי הקבצים');return data};
  const search=async(query,{mode='content',contentSearch={},scopePath='',fileType='all',limit=150,offset=0,sort={},signal=null}={})=>{const data=await request('/documents/search',{method:'POST',body:{query:String(query||''),mode:mode==='content'?'content':'everything',contentSearch,scopePath:String(scopePath||''),fileType:String(fileType||'all'),limit,offset:Math.max(0,Math.trunc(Number(offset)||0)),sort:{field:String(sort?.field||''),direction:String(sort?.direction||'')}},timeoutMs:REQUEST_TIMEOUT_MS,signal});requireBridgeVersion(data?.bridgeVersion);return data};
  const preview=(id,{signal=null}={})=>request('/documents/preview',{method:'POST',body:{id},timeoutMs:12000,signal});
  const matches=async(id,{signal=null}={})=>{const data=await request('/documents/matches',{method:'POST',body:{id},timeoutMs:18000,signal});requireBridgeVersion(data?.bridgeVersion,'לקבל מיקומי התאמות בתוך PDF אינטראקטיבי');return data};
  const previewFile=(id,{signal=null}={})=>requestBlob('/documents/preview-file',{body:{id},timeoutMs:35000,signal});
  const nativePreview=(id,geometry)=>request('/documents/native-preview',{method:'POST',body:{id,geometry},timeoutMs:12000});
  const moveNativePreview=geometry=>request('/documents/native-preview/move',{method:'POST',body:{geometry},timeoutMs:3500});
  const hideNativePreview=()=>request('/documents/native-preview/hide',{method:'POST',body:{},timeoutMs:3500});
  const openDocument=id=>request('/documents/open',{method:'POST',body:{id},timeoutMs:7000});
  const fileAction=async(path,id,timeoutMs)=>{try{return await request(path,{method:'POST',body:{id},timeoutMs})}catch(error){if(error?.code==='NOT_FOUND'||error?.httpStatus===404)throw bridgeError('Document Bridge במחשב זה ישן. הרץ מחדש את install_document_bridge.bat מהגרסה המעודכנת.','DOCUMENT_BRIDGE_UPGRADE_REQUIRED');throw error}};
  const revealDocument=id=>fileAction('/documents/reveal',id,7000);
  const deleteDocument=id=>fileAction('/documents/delete',id,35000);
  return {provider:'everything',providerLabel:'Everything',getToken,setToken,health,status,warm,pdfIndexStatus,startPdfIndex,stopPdfIndex,selectFolder,recent,search,preview,matches,previewFile,nativePreview,moveNativePreview,hideNativePreview,openDocument,revealDocument,deleteDocument};
}
