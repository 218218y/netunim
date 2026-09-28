const BRIDGE_URL='http://127.0.0.1:8766';
const TOKEN_KEY='netunim_orders_document_bridge_token_v1';
const REQUEST_TIMEOUT_MS=25000;
const EXPECTED_BRIDGE_VERSION=18;

function bridgeError(message,code='DOCUMENT_BRIDGE_ERROR',extra={}){const error=new Error(message);error.code=code;error.httpStatus=Number(extra?.httpStatus)||0;error.rootErrors=Array.isArray(extra?.rootErrors)?extra.rootErrors:[];return error}

export function createDomainsDocumentBridge(){
  function getToken(){return localStorage.getItem(TOKEN_KEY)||''}
  function setToken(value){const token=String(value||'').trim();if(token)localStorage.setItem(TOKEN_KEY,token);else localStorage.removeItem(TOKEN_KEY);return token}
  async function request(path,{method='GET',body=null,timeoutMs=REQUEST_TIMEOUT_MS,signal=null,auth=true}={}){
    const token=getToken();if(auth&&!token)throw bridgeError('חסר מפתח Document Bridge במחשב זה.','DOCUMENT_BRIDGE_NOT_PAIRED');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);const onAbort=()=>controller.abort();signal?.addEventListener?.('abort',onAbort,{once:true});
    try{
      const response=await fetch(BRIDGE_URL+path,{method,headers:{...(auth?{Authorization:`Bearer ${token}`}:{Accept:'application/json'}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:controller.signal,cache:'no-store'});
      const text=await response.text();let data={};try{data=text?JSON.parse(text):{}}catch{}
      if(!response.ok||data.ok===false)throw bridgeError(data.message||`Document Bridge החזיר שגיאה (${response.status})`,data.code||`HTTP_${response.status}`,{httpStatus:response.status,rootErrors:data.rootErrors});
      return data;
    }catch(error){
      if(error?.name==='AbortError')throw bridgeError(signal?.aborted?'החיפוש הקודם בוטל.':'Document Bridge לא הגיב בזמן.','DOCUMENT_BRIDGE_ABORTED');
      if(error?.code)throw error;
      throw bridgeError('לא ניתן להתחבר ל-Document Bridge במחשב זה.','DOCUMENT_BRIDGE_UNAVAILABLE');
    }finally{clearTimeout(timer);signal?.removeEventListener?.('abort',onAbort)}
  }
  async function requestBlob(path,{body,timeoutMs=REQUEST_TIMEOUT_MS,signal=null}={}){
    const token=getToken();if(!token)throw bridgeError('חסר מפתח Document Bridge במחשב זה.','DOCUMENT_BRIDGE_NOT_PAIRED');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);const onAbort=()=>controller.abort();signal?.addEventListener?.('abort',onAbort,{once:true});
    try{
      const response=await fetch(BRIDGE_URL+path,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body||{}),signal:controller.signal,cache:'no-store'});
      if(!response.ok){let data={};try{data=await response.json()}catch{}throw bridgeError(data.message||`Document Bridge החזיר שגיאה (${response.status})`,data.code||`HTTP_${response.status}`,{httpStatus:response.status})}
      return await response.blob();
    }catch(error){
      if(error?.name==='AbortError')throw bridgeError(signal?.aborted?'התצוגה הקודמת בוטלה.':'Document Bridge לא הגיב בזמן.','DOCUMENT_BRIDGE_ABORTED');
      if(error?.code)throw error;throw bridgeError('לא ניתן להתחבר ל-Document Bridge במחשב זה.','DOCUMENT_BRIDGE_UNAVAILABLE');
    }finally{clearTimeout(timer);signal?.removeEventListener?.('abort',onAbort)}
  }
  const health=()=>request('/health',{auth:false,timeoutMs:2500});
  const status=()=>request('/status',{timeoutMs:5000});
  const warm=()=>request('/documents/warm',{method:'POST',body:{},timeoutMs:8000});
  const recent=({limit=150,signal=null}={})=>request('/documents/recent',{method:'POST',body:{limit},timeoutMs:REQUEST_TIMEOUT_MS,signal});
  const search=async(query,{mode='content',contentSearch={},limit=60,signal=null}={})=>{const data=await request('/documents/search',{method:'POST',body:{query:String(query||''),mode:mode==='content'?'content':'everything',contentSearch,limit},timeoutMs:REQUEST_TIMEOUT_MS,signal});if(Number(data?.bridgeVersion)!==EXPECTED_BRIDGE_VERSION)throw bridgeError(`Document Bridge פעיל בגרסה ${Number(data?.bridgeVersion)||'ישנה'} במקום ${EXPECTED_BRIDGE_VERSION}. הרץ מחדש את install_document_bridge.bat כדי לטעון את גרסת החיפוש הנכונה.`,'DOCUMENT_BRIDGE_UPGRADE_REQUIRED');return data};
  const preview=id=>request('/documents/preview',{method:'POST',body:{id},timeoutMs:12000});
  const matches=(id,{signal=null}={})=>request('/documents/matches',{method:'POST',body:{id},timeoutMs:18000,signal});
  const previewFile=(id,{signal=null}={})=>requestBlob('/documents/preview-file',{body:{id},timeoutMs:35000,signal});
  const nativePreview=(id,geometry)=>request('/documents/native-preview',{method:'POST',body:{id,geometry},timeoutMs:12000});
  const moveNativePreview=geometry=>request('/documents/native-preview/move',{method:'POST',body:{geometry},timeoutMs:3500});
  const hideNativePreview=()=>request('/documents/native-preview/hide',{method:'POST',body:{},timeoutMs:3500});
  const openDocument=id=>request('/documents/open',{method:'POST',body:{id},timeoutMs:7000});
  const fileAction=async(path,id,timeoutMs)=>{try{return await request(path,{method:'POST',body:{id},timeoutMs})}catch(error){if(error?.code==='NOT_FOUND'||error?.httpStatus===404)throw bridgeError('Document Bridge במחשב זה ישן. הרץ מחדש את install_document_bridge.bat מהגרסה המעודכנת.','DOCUMENT_BRIDGE_UPGRADE_REQUIRED');throw error}};
  const revealDocument=id=>fileAction('/documents/reveal',id,7000);
  const deleteDocument=id=>fileAction('/documents/delete',id,35000);
  return {provider:'everything',providerLabel:'Everything',getToken,setToken,health,status,warm,recent,search,preview,matches,previewFile,nativePreview,moveNativePreview,hideNativePreview,openDocument,revealDocument,deleteDocument};
}
