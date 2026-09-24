export const CREDIT_SYNC_MODE_QUICK='quick';
export const CREDIT_SYNC_MODE_FORECAST='forecast';
export const CREDIT_SYNC_MODE_RECOVERY='recovery';
export const CREDIT_AUTO_MODE_SMART='smart';
export const CREDIT_FORECAST_REFRESH_MS=7*24*60*60*1000;

const FETCH_MODES=new Set([CREDIT_SYNC_MODE_QUICK,CREDIT_SYNC_MODE_FORECAST,CREDIT_SYNC_MODE_RECOVERY]);
const AUTO_MODES=new Set([CREDIT_AUTO_MODE_SMART,CREDIT_SYNC_MODE_QUICK,CREDIT_SYNC_MODE_FORECAST,CREDIT_SYNC_MODE_RECOVERY]);

function validDate(value){const date=value instanceof Date?new Date(value):new Date(value);return Number.isFinite(date.getTime())?date:null}
function monthIndexFromDate(value){const date=validDate(value);return date?date.getUTCFullYear()*12+date.getUTCMonth():null}
function monthIndexFromKey(value){const match=/^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(value||''));return match?Number(match[1])*12+Number(match[2])-1:null}
function cardMappingKey(profileId,accountNumber){return `${String(profileId||'').trim()}:${String(accountNumber||'').trim()}`}

export function normalizeCreditFetchMode(value,fallback=CREDIT_SYNC_MODE_QUICK){
  const raw=String(value||'').trim();
  if(FETCH_MODES.has(raw))return raw;
  // Backwards compatibility with Bridge v58 and older browser preferences.
  if(raw==='daily')return CREDIT_SYNC_MODE_QUICK;
  if(raw==='full')return CREDIT_SYNC_MODE_RECOVERY;
  return FETCH_MODES.has(fallback)?fallback:CREDIT_SYNC_MODE_QUICK;
}

export function normalizeCreditAutoMode(value){
  const raw=String(value||'').trim();
  if(AUTO_MODES.has(raw))return raw;
  if(raw==='daily')return CREDIT_SYNC_MODE_QUICK;
  if(raw==='full')return CREDIT_SYNC_MODE_RECOVERY;
  return CREDIT_AUTO_MODE_SMART;
}

export function creditSmartSyncMode(syncValue,{now=new Date(),profileIds=[],forecastRefreshMs=CREDIT_FORECAST_REFRESH_MS}={}){
  const nowDate=validDate(now)||new Date(),currentIndex=monthIndexFromDate(nowDate),source=syncValue&&typeof syncValue==='object'&&!Array.isArray(syncValue)?syncValue:{},allProfiles=Array.isArray(source.profiles)?source.profiles:[],wanted=new Set((Array.isArray(profileIds)?profileIds:[]).map(value=>String(value||'').trim()).filter(Boolean)),profiles=wanted.size?allProfiles.filter(profile=>wanted.has(String(profile?.profileId||'').trim())):allProfiles;
  if(!profiles.length||wanted.size&&profiles.length<wanted.size)return CREDIT_SYNC_MODE_RECOVERY;
  const mappings=source.cardMappings&&typeof source.cardMappings==='object'&&!Array.isArray(source.cardMappings)?source.cardMappings:{};
  const baselineIndex=currentIndex-3,requiredForecast=new Set(Array.from({length:11},(_,index)=>currentIndex+index+2));
  let relevantAccountCount=0,needsForecast=false;
  for(const profile of profiles){
    const profileId=String(profile?.profileId||'').trim(),accounts=Array.isArray(profile?.accounts)?profile.accounts:[];
    if(!accounts.length)return CREDIT_SYNC_MODE_RECOVERY;
    for(const account of accounts){
      const accountNumber=String(account?.accountNumber||'').trim(),mapping=mappings[cardMappingKey(profileId,accountNumber)];
      if(mapping?.included===false)continue;
      relevantAccountCount++;
      const months=Array.isArray(account?.months)?account.months:[],monthRows=months.map(row=>({row,index:monthIndexFromKey(row?.month)})).filter(item=>item.index!==null);
      if(!monthRows.some(item=>item.index<=baselineIndex))return CREDIT_SYNC_MODE_RECOVERY;
      const byIndex=new Map(monthRows.map(item=>[item.index,item.row]));
      for(const monthIndex of requiredForecast){
        const slice=byIndex.get(monthIndex),fetchedAt=Date.parse(slice?.fetchedAt||'');
        if(!slice||slice.status!=='fresh'||slice.fetchStatus!=='success'||!Number.isFinite(fetchedAt)||nowDate.getTime()-fetchedAt>=forecastRefreshMs){needsForecast=true;break}
      }
    }
  }
  // If every discovered card was explicitly excluded, there is nothing expensive to refresh.
  if(!relevantAccountCount)return CREDIT_SYNC_MODE_QUICK;
  return needsForecast?CREDIT_SYNC_MODE_FORECAST:CREDIT_SYNC_MODE_QUICK;
}

export function resolveCreditAutoSyncMode(preference,syncValue,options={}){
  const mode=normalizeCreditAutoMode(preference);
  return mode===CREDIT_AUTO_MODE_SMART?creditSmartSyncMode(syncValue,options):normalizeCreditFetchMode(mode);
}
