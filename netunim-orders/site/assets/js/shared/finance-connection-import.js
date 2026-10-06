const IMPORT_SCHEMA='netunim-finance-connections';
const IMPORT_VERSION=1;
const MAX_IMPORT_BYTES=32*1024;

function object(value){return value&&typeof value==='object'&&!Array.isArray(value)?value:null}
function text(value){return String(value??'').trim()}
function normalizedLabel(value){return text(value).replace(/\s+/g,' ').toLocaleLowerCase('he-IL')}

function parseDocument(raw){
  const source=String(raw??'');
  if(!source.trim())throw new Error('קובץ הייבוא ריק');
  if(new Blob([source]).size>MAX_IMPORT_BYTES)throw new Error('קובץ הייבוא גדול מהגודל המותר');
  let value;try{value=JSON.parse(source)}catch{throw new Error('קובץ הייבוא אינו JSON תקין')}
  if(!object(value))throw new Error('מבנה קובץ הייבוא אינו תקין');
  if(value.schema!==IMPORT_SCHEMA||Number(value.version)!==IMPORT_VERSION)throw new Error('קובץ הייבוא אינו בפורמט הגדרות החיבור הנתמך');
  if(value.mode!=='replace')throw new Error('קובץ הייבוא חייב להיות במצב replace');
  if(!object(value.bank))throw new Error('חסרה בקובץ הגדרת בנק');
  if(!object(value.credit)||!Array.isArray(value.credit.profiles)||!value.credit.profiles.length)throw new Error('חסרות בקובץ הגדרות אשראי');
  return value;
}

function profileMatches(imported,current){
  return text(imported?.provider)===text(current?.provider)
    && normalizedLabel(imported?.label)===normalizedLabel(current?.label)
    && normalizedLabel(imported?.ownerLabel)===normalizedLabel(current?.ownerLabel);
}

export function prepareFinanceConnectionImport(value,currentProfiles=[]){
  const parsed=parseDocument(JSON.stringify(value));
  const existing=Array.isArray(currentProfiles)?currentProfiles:[];
  const next={...parsed,credit:{...parsed.credit,profiles:parsed.credit.profiles.map(profile=>({...profile,credentials:{...(object(profile?.credentials)||{})}}))}};
  for(const profile of next.credit.profiles){
    // connectionKey is the portable identity of an imported connection. Never replace it
    // with a machine/cloud-specific profileId: doing so lets the same import file acquire
    // different identities on different computers depending on which cloud snapshot was
    // loaded (or how a mutable label was spelled) at import time.
    if(text(profile.connectionKey)){delete profile.profileId;continue}
    const explicit=text(profile.profileId);
    if(explicit&&existing.some(candidate=>text(candidate?.profileId)===explicit))continue;
    // Legacy import documents without connectionKey can still reuse one unambiguous cloud
    // identity. New portable documents must use connectionKey instead.
    const matches=existing.filter(candidate=>profileMatches(profile,candidate));
    if(matches.length===1)profile.profileId=text(matches[0].profileId);
  }
  return next;
}

export function parseFinanceConnectionImportText(raw){return parseDocument(raw)}

export function financeConnectionImportSummary(value){
  const parsed=parseDocument(JSON.stringify(value));
  const profiles=parsed.credit.profiles;
  const business=object(parsed.bank.accounts)?.business||{},home=object(parsed.bank.accounts)?.home||{};
  const accountCount=(text(business.branchNumber)&&text(business.accountNumber)?1:0)+(text(home.branchNumber)&&text(home.accountNumber)?1:0);
  return {creditProfileCount:profiles.length,bankAccountCount:accountCount};
}

export async function chooseFinanceConnectionImportFile(){
  if(typeof document==='undefined')throw new Error('בחירת קובץ אינה זמינה בסביבה זו');
  return new Promise((resolve,reject)=>{
    const input=document.createElement('input');
    input.type='file';input.accept='application/json,.json';input.hidden=true;
    const cleanup=()=>{input.remove()};
    input.addEventListener('cancel',()=>{cleanup();resolve(null)},{once:true});
    input.addEventListener('change',async()=>{
      try{
        const file=input.files?.[0];if(!file){cleanup();resolve(null);return}
        if(Number(file.size)>MAX_IMPORT_BYTES)throw new Error('קובץ הייבוא גדול מהגודל המותר');
        const parsed=parseDocument(await file.text());cleanup();resolve(parsed);
      }catch(error){cleanup();reject(error)}
    },{once:true});
    document.body.appendChild(input);input.click();
  });
}

export function createFinanceConnectionImporter({bridge,getCreditProfiles=()=>[],confirmDialog,toast,afterImport=async()=>{}}={}){
  return async function importFinanceConnections(){
    if(!bridge?.getBridgeToken?.()){toast?.('יש לצמד קודם את המחשב ל-Bank Bridge');return false}
    try{
      const status=await bridge.status();if(Number(status?.bridgeVersion||0)<66)throw new Error('יש להריץ מחדש install_bank_bridge.bat במחשב זה לפני ייבוא הגדרות');
      const selected=await chooseFinanceConnectionImportFile();if(!selected)return false;
      const payload=prepareFinanceConnectionImport(selected,getCreditProfiles()),summary=financeConnectionImportSummary(payload);
      const approved=await confirmDialog?.('ייבוא מלא של חיבורי בנק ואשראי',`הייבוא יחליף במחשב הזה את פרטי ההתחברות המקומיים לבנק ואת כל חיבורי האשראי. נמצאו ${summary.bankAccountCount} חשבונות בנק ו-${summary.creditProfileCount} חיבורי אשראי. מפתח ה-Bridge הקיים לא ישתנה.`,{confirmText:'ייבא הגדרות'});
      if(approved===false)return false;
      const result=await bridge.importConnectionSettings(payload);
      await afterImport(result);
      const cleanupWarnings=Array.isArray(result?.cleanupWarnings)?result.cleanupWarnings:[];
      toast?.(cleanupWarnings.length
        ?`הייבוא נשמר במחשב, אך ניקוי מצב ישן לא הושלם במלואו. מומלץ להפעיל מחדש את Bank Bridge לפני הסינכרון הבא.`
        :`הייבוא הושלם: ${summary.creditProfileCount} חיבורי אשראי והגדרות הבנק נשמרו מוצפנים במחשב`);
      return true;
    }catch(error){toast?.(error?.message||'ייבוא הגדרות החיבור נכשל');return false}
  };
}
