import {createBankBridgeClient} from '../shared/bank-bridge-client.js';
import {createBrowserBridgePlatform} from '../shared/browser-bridge-platform.js';
import {normalizeCreditAutoMode} from '../shared/credit-sync-policy.js';

const TOKEN_KEY='netunim_kupa_bank_bridge_token_v1';
const BANK_AUTO_KEY='netunim_orders_bank_auto_daily_v1';
const CREDIT_AUTO_KEY='netunim_orders_credit_auto_daily_v1';
const CREDIT_AUTO_MODE_KEY='netunim_orders_credit_auto_mode_v1';
const BANK_ATTEMPT_KEY='netunim_orders_bank_auto_attempt_v1';
const CREDIT_ATTEMPT_KEY='netunim_orders_credit_auto_attempt_v1';
const AUTO_RETRY_MS=60*60*1000;
const CREDIT_AUTO_RETRY_MS=24*60*60*1000;

export function createFinanceBridgeIntegration({platform=createBrowserBridgePlatform()}={}){
  const {preferences,clock}=platform;
  const tokenStore={get:()=>preferences.getItem(TOKEN_KEY)||'',set:value=>{const token=String(value||'').trim();if(token)preferences.setItem(TOKEN_KEY,token);else preferences.removeItem(TOKEN_KEY);return token}};
  const client=createBankBridgeClient({...platform,tokenStore});
  const enabled=key=>preferences.getItem(key)!=='0';
  const setEnabled=(key,value)=>preferences.setItem(key,value?'1':'0');
  const markAttempt=key=>preferences.setItem(key,String(clock.now()));
  function attemptDelayMs(key,retryMs=AUTO_RETRY_MS){const last=Number(preferences.getItem(key)||0);return last?Math.max(0,last+retryMs-clock.now()):0}
  return {...client,
    bankAutoEnabled:()=>enabled(BANK_AUTO_KEY),creditAutoEnabled:()=>enabled(CREDIT_AUTO_KEY),
    setBankAutoEnabled:value=>setEnabled(BANK_AUTO_KEY,value),setCreditAutoEnabled:value=>setEnabled(CREDIT_AUTO_KEY,value),
    creditAutoMode:()=>normalizeCreditAutoMode(preferences.getItem(CREDIT_AUTO_MODE_KEY)),
    setCreditAutoMode:value=>preferences.setItem(CREDIT_AUTO_MODE_KEY,normalizeCreditAutoMode(value)),
    markBankAttempt:()=>markAttempt(BANK_ATTEMPT_KEY),markCreditAttempt:()=>markAttempt(CREDIT_ATTEMPT_KEY),
    bankAttemptDelayMs:()=>attemptDelayMs(BANK_ATTEMPT_KEY),creditAttemptDelayMs:()=>attemptDelayMs(CREDIT_ATTEMPT_KEY,CREDIT_AUTO_RETRY_MS),
    bankAttemptReady:()=>attemptDelayMs(BANK_ATTEMPT_KEY)===0,creditAttemptReady:()=>attemptDelayMs(CREDIT_ATTEMPT_KEY,CREDIT_AUTO_RETRY_MS)===0,
  };
}
