

export function validState(d){return d&&Array.isArray(d.checks)&&Array.isArray(d.credits)&&Array.isArray(d.cash)&&(!Object.prototype.hasOwnProperty.call(d,'rights')||Array.isArray(d.rights))&&(!Object.prototype.hasOwnProperty.call(d,'notes')||Array.isArray(d.notes))&&(d.rightsLastCalculatedDate===undefined||d.rightsLastCalculatedDate===null||typeof d.rightsLastCalculatedDate==='string')&&Array.isArray(d.expenses)&&Array.isArray(d.cards)}

export function assertPortablePayload(payload){
  if(!payload||typeof payload!=='object'||Array.isArray(payload)||!validState(payload))throw new Error('מבנה קובץ הנתונים אינו תקין');
  const meta=payload._meta;
  if(meta!==undefined&&(!meta||typeof meta!=='object'||Array.isArray(meta)))throw new Error('פרטי הגיבוי אינם תקינים');
  if(meta?.format!==undefined&&meta.format!=='kupa-portable')throw new Error('הגיבוי שייך למערכת אחרת');
  for(const [value,max] of [[meta?.schemaVersion,6],[payload.version,4]]){
    if(value===undefined)continue; // Older, unversioned local files remain supported.
    const version=Number(value);
    if(!Number.isInteger(version)||version<1||version>max)throw new Error('גרסת הגיבוי אינה נתמכת; יש לפתוח אותו בגרסת מערכת מתאימה');
  }
  return payload;
}

export function validKupaCloudState(d){return !!(d&&typeof d==='object'&&!Array.isArray(d)&&!Object.prototype.hasOwnProperty.call(d,'checks')&&Array.isArray(d.credits)&&Array.isArray(d.cash)&&(!Object.prototype.hasOwnProperty.call(d,'rights')||Array.isArray(d.rights))&&(!Object.prototype.hasOwnProperty.call(d,'notes')||Array.isArray(d.notes))&&(d.rightsLastCalculatedDate===undefined||d.rightsLastCalculatedDate===null||typeof d.rightsLastCalculatedDate==='string')&&Array.isArray(d.expenses)&&Array.isArray(d.cards)&&d.bank&&typeof d.bank==='object'&&!Array.isArray(d.bank)&&Array.isArray(d.bank.adjustments)&&!d.bank.adjustments.some(a=>a?.type==='check_deposit'))}

export function assertValidCloudState(d,context='נתוני הקופה'){
  if(!validKupaCloudState(d))throw new Error(`${context} במבנה לא תקין. הסנכרון נעצר כדי למנוע דריסה או אובדן נתונים.`);
  return d
}

export function hasMeaningfulState(s){return ['checks','credits','cash','rights','notes','expenses','cards'].some(k=>Array.isArray(s?.[k])&&s[k].length)||!!s?.rightsLastCalculatedDate||s?.bank?.currentBalance!==null&&s?.bank?.currentBalance!==undefined||Array.isArray(s?.bank?.adjustments)&&s.bank.adjustments.length||Array.isArray(s?.creditSync?.profiles)&&s.creditSync.profiles.length}
