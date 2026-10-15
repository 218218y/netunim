import {normalizeCashflowSettings} from '../../shared/cashflow.js';

// Shared cashflow edits use the Kupa document command, not Finance publication.
export function createCashflowSettingsCommands({mutateKupaCloud,loadSession,toast}){
  async function saveCashflowMinimum(account,value){
    const raw=String(value??'').trim(),parsed=raw===''?null:Number(raw);
    if(parsed!==null&&!Number.isFinite(parsed)){toast('סכום המינימום אינו תקין');return false}
    if(!loadSession()){toast('יש להתחבר לענן כדי לשמור את ההגדרה המשותפת');return false}
    try{
      const saved=await mutateKupaCloud(kupa=>{const settings=normalizeCashflowSettings(kupa.cashflowSettings);if(account==='home')settings.homeMinimum=parsed;else settings.businessMinimum=parsed;kupa.cashflowSettings=normalizeCashflowSettings(settings);return kupa});
      toast(saved.publicationWarning||'סף ההתראה התזרימי נשמר ומשותף לשתי המערכות');
      return true;
    }catch(error){toast(error?.message||String(error));return false}
  }

  async function saveCashflowCheckCutoff(account,value){
    const parsed=Number(value);
    if(!Number.isInteger(parsed)||parsed<1||parsed>31){toast('יום חישוב הצ׳קים חייב להיות מספר שלם בין 1 ל־31');return false}
    if(!loadSession()){toast('יש להתחבר לענן כדי לשמור את ההגדרה המשותפת');return false}
    try{
      const saved=await mutateKupaCloud(kupa=>{const settings=normalizeCashflowSettings(kupa.cashflowSettings);if(account==='home')settings.homeCheckCutoffDay=parsed;else settings.businessCheckCutoffDay=parsed;kupa.cashflowSettings=normalizeCashflowSettings(settings);return kupa});
      toast(saved.publicationWarning||'יום חישוב הצ׳קים בתזרים נשמר ומשותף לשתי המערכות');
      return true;
    }catch(error){toast(error?.message||String(error));return false}
  }

return {saveCashflowMinimum,saveCashflowCheckCutoff};
}
