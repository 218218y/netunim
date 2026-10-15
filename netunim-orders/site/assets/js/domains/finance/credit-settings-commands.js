import {applyCreditCardOrderData} from '../../shared/credit-card-order.js';
import {applyCreditCardAccountTransitionData} from '../../shared/credit-card-account.js';
import {checkTodayISO} from '../../core/dates.js';
import {creditCardMappingKey,normalizeCreditSync} from './credit-feed.js';

// Manual credit commands retain their account/connection fence, while provider
// acquisition and refresh stay owned by the existing refresh capability.
export function createCreditSettingsCommands({local,operationScope,connections,mutateFinanceCloud,automation,toast}){
const supportedCreditBridge=connections.queries.supported;
const refreshCreditBridgeStatus=connections.queries.refreshStatus;
const setCreditAutoEnabled=(...args)=>automation.setCreditAutoEnabled(...args);
const setCreditAutoMode=(...args)=>automation.setCreditAutoMode(...args);
const scheduleCreditAuto=(...args)=>automation.scheduleCreditAuto(...args);
const financeAutomation=automation;
  async function connectionWrite(run,{clearError=false}={}){
    if(local.creditBusy)return false;local.creditBusy=true;
    if(clearError){local.creditError='';local.creditErrorAt=null}
    try{const assertConnection=connections.queries.capture(),result=await run();try{assertConnection()}catch{return false}if(result.failure){local.creditError=result.failure;local.creditErrorAt=new Date().toISOString();toast(local.creditError)}return result.ok}
    finally{local.creditBusy=false}
  }
  function saveCreditProfile(profile){return connectionWrite(()=>connections.commands.saveProfile(profile),{clearError:true})}
  function deleteCreditProfile(profileId){return connectionWrite(()=>connections.commands.deleteProfile(profileId))}
  async function resetCreditSync(){
    if(local.creditBusy)return false;local.creditBusy=true;
    try{
      const assertOwner=operationScope.capture(),assertConnection=connections.queries.capture(),assertCurrent=()=>{assertOwner();assertConnection()},status=connections.queries.snapshot().status||await refreshCreditBridgeStatus({quiet:true});
      assertCurrent();if(!status)throw new Error(connections.queries.snapshot().bridgeError||'Bank Bridge אינו זמין');
      if(!supportedCreditBridge(status))throw new Error('יש לשדרג את Bank Bridge לפני איפוס מלא של סנכרון האשראי');
      await connections.commands.resetProfiles();assertCurrent();
      const saved=await mutateFinanceCloud(finance=>{finance.creditSync=normalizeCreditSync({});return finance},null,{assertCurrent});assertCurrent();
      setCreditAutoEnabled(false);setCreditAutoMode('smart');
      local.creditError=saved.publicationWarning||'';local.creditErrorAt=local.creditError?new Date().toISOString():null;
      toast(local.creditError||financeAutomation.preferenceState().creditAutomationWarning||'סנכרון האשראי אופס והחיבורים המקומיים נמחקו');return true;
    }catch(error){local.creditError=error?.message||String(error);local.creditErrorAt=new Date().toISOString();toast(local.creditError);return false}
    finally{local.creditBusy=false;scheduleCreditAuto()}
  }

  async function saveCreditCardOrder(keys){const saved=await mutateFinanceCloud(finance=>({...finance,creditSync:applyCreditCardOrderData(normalizeCreditSync(finance.creditSync),keys)}));if(local.creditError==='finance_sync_lease_busy'){local.creditError='';local.creditErrorAt=null}toast(saved.publicationWarning||'סדר הכרטיסים נשמר');return true}

  async function setCreditCardMapping(profileId,accountNumber,field,value){try{const saved=await mutateFinanceCloud(kupa=>{const sync=normalizeCreditSync(kupa.creditSync),profile=sync.profiles.find(p=>p.profileId===profileId),key=creditCardMappingKey(profileId,accountNumber);let current=sync.cardMappings[key]||{included:false,hidden:false,account:profile?.defaultAccount==='ביתי'?'ביתי':'עסקי',cardName:'',manualFrame:null};if(field==='included')current.included=!!value;else if(field==='hidden')current.hidden=!!value;else if(field==='account')current=applyCreditCardAccountTransitionData(current,value,checkTodayISO());else if(field==='cardName')current.cardName=String(value||'').trim().slice(0,100);else if(field==='sortOrder'){const raw=String(value??'').trim(),order=raw===''?null:Number(raw);if(order!==null&&(!Number.isSafeInteger(order)||order<1))throw new Error('סדר הכרטיס חייב להיות מספר שלם חיובי');current.sortOrder=order}else if(field==='manualFrame'){const raw=String(value??'').trim(),amount=raw===''?null:Number(raw);if(amount!==null&&(!Number.isFinite(amount)||amount<0))throw new Error('מסגרת ידנית חייבת להיות מספר חיובי או אפס');current.manualFrame=amount===null?null:Math.round(amount*100)/100}else return null;sync.cardMappings[key]=current;kupa.creditSync=sync;return kupa});if(local.creditError==='finance_sync_lease_busy'){local.creditError='';local.creditErrorAt=null}toast(saved.publicationWarning||'שיוך כרטיס האשראי עודכן');return true}catch(error){toast(error?.message||'שמירת הגדרת הכרטיס נכשלה');return false}}

  async function acknowledgeCreditSettlementWarning(warningId){
    const id=String(warningId||'').trim();
    if(!id.startsWith('credit_settlement_unmatched:'))return false;
    try{
      const saved=await mutateFinanceCloud(finance=>{const sync=normalizeCreditSync(finance.creditSync);sync.settlementWarningAcks={...(sync.settlementWarningAcks||{}),[id]:new Date().toISOString()};finance.creditSync=normalizeCreditSync(sync);return finance});
      toast(saved.publicationWarning||'אזהרת התאמת האשראי סומנה כנבדקה');
      return true;
    }catch(error){toast(error?.message||'שמירת אישור האזהרה נכשלה');return false}
  }

return {saveCreditProfile,deleteCreditProfile,resetCreditSync,saveCreditCardOrder,setCreditCardMapping,acknowledgeCreditSettlementWarning};
}
