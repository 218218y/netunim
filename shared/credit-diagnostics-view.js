// Presentation only: retain the original issues and their financial coverage state.
export function creditDiagnosticKey(error={}){
  return JSON.stringify(['profileId','provider','code','component','tier','severity','month','accountSuffix','stage','message','at','diagnosticFingerprint'].map(key=>String(error?.[key]||'')));
}

function partialMaxForecast(error){
  return error?.provider==='max'&&error.code==='CREDIT_PROVIDER_SCHEMA_ERROR'&&error.severity==='warning'&&
    error.component==='forecast_transactions'&&[undefined,null,'','forecast'].includes(error.tier)&&/^\d{4}-(?:0[1-9]|1[0-2])$/.test(String(error.month||''));
}

function diagnosticMeta(error,syncDate){
  return [error?.code?`קוד: ${error.code}`:'',error?.component?`רכיב: ${error.component}`:'',
    error?.stage?`שלב: ${error.stage}`:'',error?.month?`חודש: ${error.month}`:'',
    error?.accountSuffix?`כרטיס: ••${error.accountSuffix}`:'',error?.httpStatus?`HTTP: ${error.httpStatus}`:'',
    error?.browserEngine?`דפדפן: ${error.browserEngine==='chromium'?'Chrome/Edge':'Camoufox'}`:'',
    error?.retryAfterAt?`מושהה עד: ${syncDate(error.retryAfterAt)}`:'',
    error?.diagnosticFingerprint?`אבחון: ${error.diagnosticFingerprint}`:'',
    error?.originalFailureAt?`הכשל המקורי: ${syncDate(error.originalFailureAt)}`:error?.at?syncDate(error.at):''].filter(Boolean).join(' · ');
}

function monthSummary(errors){
  const months=[...new Set(errors.map(error=>error.month))].sort();
  const ordinal=month=>Number(month.slice(0,4))*12+Number(month.slice(5));
  const contiguous=months.every((month,index)=>!index||ordinal(month)===ordinal(months[index-1])+1);
  return months.length>1&&contiguous?`${months[0]}–${months.at(-1)} (${months.length} חודשים)`:months.join(' · ');
}

export function creditDiagnosticMarkup(errors,{esc,syncDate,providerLabels,variant}){
  const rows=Array.isArray(errors)?errors:[],forecast=rows.filter(partialMaxForecast);
  const detailClass=variant==='orders'?'finance-sync-detail':'credit-sync-detail';
  const label=error=>error?.label||providerLabels[error?.provider]||error?.provider||'חברת אשראי';
  const meta=error=>{const value=diagnosticMeta(error,syncDate);return value?`<small>${esc(value)}</small>`:''};
  let grouped=false;
  return rows.map(error=>{
    if(partialMaxForecast(error)){
      if(grouped)return '';grouped=true;
      const evidence=forecast.map(row=>`<div class="${detailClass} warn"><b>${esc(label(row))}</b>${meta(row)}</div>`).join('');
      const count=forecast.length===1?'הודעה אחת':`${forecast.length} הודעות`;
      return `<div class="${detailClass} warn"><b>תחזית MAX חלקית</b><span>לא התקבל פירוט שניתן לאמת לחלק מחודשי התחזית. מידע קודם, אם קיים, נשמר; החודשים החסרים אינם מאומתים כחודשים ריקים.</span><small>חודשים: <bdi dir="ltr">${esc(monthSummary(forecast))}</bdi></small><details class="credit-forecast-evidence"><summary>פרטי אבחון · ${count}</summary>${evidence}</details></div>`;
    }
    const severity=['warning','deferred','info'].includes(error?.severity)?'warn':'error';
    return `<div class="${detailClass} ${severity}"><b>${esc(error?.severity==='deferred'?'מושהה — '+label(error):label(error))}</b><span>${esc(error?.message||'סנכרון האשראי נכשל')}</span>${meta(error)}</div>`;
  }).join('');
}
