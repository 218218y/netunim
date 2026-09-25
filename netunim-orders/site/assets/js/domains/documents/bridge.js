const BRIDGE_URL='http://127.0.0.1:8766';
const TOKEN_KEY='netunim_orders_document_bridge_token_v1';
const REQUEST_TIMEOUT_MS=9000;

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
  const health=()=>request('/health',{auth:false,timeoutMs:2500});
  const status=()=>request('/status',{timeoutMs:5000});
  const search=(query,{limit=40,signal=null}={})=>request('/documents/search',{method:'POST',body:{query:String(query||''),limit},timeoutMs:REQUEST_TIMEOUT_MS,signal});
  const openDocument=id=>request('/documents/open',{method:'POST',body:{id},timeoutMs:5000});
  return {getToken,setToken,health,status,search,openDocument};
}
