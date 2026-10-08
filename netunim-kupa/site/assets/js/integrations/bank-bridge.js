import {createBankBridgeClient} from '../shared/bank-bridge-client.js';
import {createBrowserBridgePlatform} from '../shared/browser-bridge-platform.js';

const TOKEN_KEY='netunim_kupa_bank_bridge_token_v1';
const AUTO_KEY='netunim_kupa_bank_auto_daily_v1';
const AUTO_ATTEMPT_KEY='netunim_kupa_bank_auto_attempt_v1';
const AUTO_RETRY_COOLDOWN_MS=60*60*1000;

export function createBankBridgeIntegration({platform=createBrowserBridgePlatform()}={}){
  const {preferences,clock}=platform;
  const tokenStore={get:()=>preferences.getItem(TOKEN_KEY)||'',set:value=>{const token=String(value||'').trim();if(token)preferences.setItem(TOKEN_KEY,token);else preferences.removeItem(TOKEN_KEY);return token}};
  const client=createBankBridgeClient({...platform,tokenStore,messages:{
    notPaired:'חסר מפתח Bank Bridge. יש להזין את המפתח שמופיע בהתקנת החיבור המקומי.',
    timeout:'Bank Bridge לא הגיב בזמן. ודא שהוא פועל במחשב ונסה שוב.',
    unavailable:'לא ניתן להתחבר ל-Bank Bridge המקומי. הפעל את start_bank_bridge.bat ונסה שוב.',
    imageNotPaired:'חסר מפתח Bank Bridge.',
  }});
  function autoAttemptDelayMs(now=clock.now()){const last=Number(preferences.getItem(AUTO_ATTEMPT_KEY)||0);return last?Math.max(0,last+AUTO_RETRY_COOLDOWN_MS-now):0}
  return {...client,
    autoEnabled:()=>preferences.getItem(AUTO_KEY)!=='0',
    setAutoEnabled:enabled=>preferences.setItem(AUTO_KEY,enabled?'1':'0'),
    markAutoAttempt:(now=clock.now())=>preferences.setItem(AUTO_ATTEMPT_KEY,String(now)),
    autoAttemptDelayMs,autoAttemptReady:(now=clock.now())=>autoAttemptDelayMs(now)===0,
  };
}
