import {createDocumentBridgeClient} from '../shared/document-bridge-client.js';
import {createBrowserBridgePlatform} from '../shared/browser-bridge-platform.js';

const TOKEN_KEY='netunim_document_bridge_token_v1';
const LEGACY_TOKEN_KEYS=['netunim_orders_document_bridge_token_v1','netunim_kupa_document_bridge_token_v1'];

// Device-only preferences retain installed clients' pairing keys. A failed
// best-effort migration leaves the legacy token readable for the next request.
export function createDocumentBridgeIntegration({platform=createBrowserBridgePlatform()}={}){
  const {preferences,fetchRequest,timers,createAbortController}=platform;
  function get(){
    const current=preferences.getItem(TOKEN_KEY)||'';if(current)return current;
    for(const key of LEGACY_TOKEN_KEYS){const legacy=preferences.getItem(key)||'';if(!legacy)continue;try{preferences.setItem(TOKEN_KEY,legacy)}catch{}return legacy}
    return '';
  }
  function set(value){
    const token=String(value||'').trim();if(token)preferences.setItem(TOKEN_KEY,token);else preferences.removeItem(TOKEN_KEY);
    for(const key of LEGACY_TOKEN_KEYS)try{preferences.removeItem(key)}catch{}
    return token;
  }
  return createDocumentBridgeClient({tokenStore:{get,set},fetchRequest,timers,createAbortController});
}
