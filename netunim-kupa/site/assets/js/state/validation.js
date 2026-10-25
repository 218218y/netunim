/** @param {unknown} value @returns {value is Record<string,unknown>} */
function record(value){return value!==null&&typeof value==='object'}
/** @param {unknown} value @param {string} key @returns {unknown} */
function field(value,key){return record(value)?value[key]:undefined}
import {notesSheetHasMeaningfulData} from '../shared/notes-sheet-model.js';
import {assertEntityCollection,assertEntityCollections} from '../shared/data-invariants.js';

export const KUPA_ENTITY_COLLECTIONS=Object.freeze(['credits','cash','rights','notes','expenses','cards','notesSheet.rows','notesSheet.columns','notesSheet.sheets']);

/** @param {unknown} input @param {{includeChecks?:boolean,required?:boolean,allowLegacyCards?:boolean}} [options] */
export function assertKupaEntityInvariants(input,{includeChecks=false,required=false,allowLegacyCards=false}={}){
  const state=record(input)?input:{};
  const paths=KUPA_ENTITY_COLLECTIONS.filter(path=>path!=='cards'&&(!path.startsWith('notesSheet.')||state?.notesSheet!==undefined)&&(path!=='notesSheet.sheets'||Number(field(state.notesSheet,'version'))>=2));const accepted=assertEntityCollections(input,includeChecks?[...paths,'checks']:paths,{required});
  if(Array.isArray(state?.cards)&&allowLegacyCards){
    const migrated=state.cards.filter((/** @type {unknown} */ card)=>field(card,'id')!==undefined);assertEntityCollection(migrated,'cards');
  }else assertEntityCollection(state?.cards,'cards',{required});
  return accepted;
}

/** @param {unknown} value */
function validNotesSheet(value){
  if(value===undefined)return true;
  if(!record(value)||Array.isArray(value)||!Array.isArray(value.columns)||!value.columns.length||!Array.isArray(value.rows))return false;
  const workbook=Number(value.version)>=2;
  if(workbook){
    if(!Array.isArray(value.sheets)||!value.sheets.length||!value.sheets.every((/** @type {unknown} */ sheet)=>record(sheet)&&String(sheet.id||'').trim()&&String(sheet.name||'').trim()))return false;
    const ids=new Set(value.sheets.map((/** @type {unknown} */ sheet)=>String(field(sheet,'id'))));
    if(ids.size!==value.sheets.length)return false;
    if(value.columns.some((/** @type {unknown} */ column)=>!record(column)||!String(column.id||'').trim()||!ids.has(String(column.sheetId||''))))return false;
    if(value.rows.some((/** @type {unknown} */ row)=>!record(row)||!String(row.id||'').trim()||!ids.has(String(row.sheetId||''))||!row.cells||typeof row.cells!=='object'||Array.isArray(row.cells)))return false;
    return true
  }
  return value.columns.every((/** @type {unknown} */ column)=>record(column)&&String(column.id||'').trim())
    &&value.rows.every((/** @type {unknown} */ row)=>record(row)&&String(row.id||'').trim()&&row.cells&&typeof row.cells==='object'&&!Array.isArray(row.cells))
}

/** @param {unknown} state */
export function validState(state){
  try{return !!(record(state)&&Array.isArray(state.checks)&&Array.isArray(state.credits)&&Array.isArray(state.cash)&&(!Object.hasOwn(state,'rights')||Array.isArray(state.rights))&&(!Object.hasOwn(state,'notes')||Array.isArray(state.notes))&&validNotesSheet(state.notesSheet)&&(state.rightsLastCalculatedDate===undefined||state.rightsLastCalculatedDate===null||typeof state.rightsLastCalculatedDate==='string')&&Array.isArray(state.expenses)&&Array.isArray(state.cards)&&assertKupaEntityInvariants(state,{includeChecks:true,required:false,allowLegacyCards:true}))}catch{return false}
}

/** @param {unknown} payload */
export function assertPortablePayload(payload){
  if(!record(payload)||Array.isArray(payload)||!validState(payload))throw new Error('מבנה קובץ הנתונים אינו תקין');
  const meta=payload._meta;if(meta!==undefined&&(!record(meta)||Array.isArray(meta)))throw new Error('פרטי הגיבוי אינם תקינים');
  if(field(meta,'format')!==undefined&&field(meta,'format')!=='kupa-portable')throw new Error('הגיבוי שייך למערכת אחרת');
  for(const [value,max] of /** @type {[unknown,number][]} */ ([[field(meta,'schemaVersion'),6],[payload.version,4]])){if(value===undefined)continue;const version=Number(value);if(!Number.isInteger(version)||version<1||version>max)throw new Error('גרסת הגיבוי אינה נתמכת; יש לפתוח אותו בגרסת מערכת מתאימה')}
  return payload;
}

/** @param {unknown} state @param {{allowLegacyCards?:boolean,requiredEntities?:boolean}} [options] */
export function validKupaCloudState(state,{allowLegacyCards=false,requiredEntities=true}={}){
  try{return !!(record(state)&&!Array.isArray(state)&&!Object.hasOwn(state,'checks')&&Array.isArray(state.credits)&&Array.isArray(state.cash)
    &&(!Object.hasOwn(state,'rights')||Array.isArray(state.rights))&&(!Object.hasOwn(state,'notes')||Array.isArray(state.notes))&&validNotesSheet(state.notesSheet)
    &&(state.rightsLastCalculatedDate===undefined||state.rightsLastCalculatedDate===null||typeof state.rightsLastCalculatedDate==='string')
    &&Array.isArray(state.expenses)&&Array.isArray(state.cards)&&record(state.bank)&&!Array.isArray(state.bank)&&Array.isArray(state.bank.adjustments)
    &&!state.bank.adjustments.some((/** @type {unknown} */ item)=>field(item,'type')==='check_deposit')
    &&assertKupaEntityInvariants(state,{required:requiredEntities,allowLegacyCards}))}catch{return false}
}

/** @template T @param {T} state @param {string} [context] @returns {T} */
export function assertValidCloudState(state,context='נתוני הקופה'){
  if(!validKupaCloudState(state))throw new Error(`${context} במבנה לא תקין. הסנכרון נעצר כדי למנוע דריסה או אובדן נתונים.`);return state;
}

/** @template T @param {T} state @param {string} [context] @returns {T} */
export function assertReadableCloudState(state,context='נתוני הקופה בענן'){
  if(!validKupaCloudState(state,{allowLegacyCards:true,requiredEntities:false}))throw new Error(`${context} במבנה לא תקין. הסנכרון נעצר כדי למנוע דריסה או אובדן נתונים.`);return state;
}

/** @param {unknown} input */
export function hasMeaningfulState(input){
  const state=record(input)?input:{},bank=record(state.bank)?state.bank:{},credit=record(state.creditSync)?state.creditSync:{};
  return ['checks','credits','cash','rights','notes','expenses','cards'].some(key=>Array.isArray(state?.[key])&&(Array.isArray(state[key])?state[key].length:0))
    ||notesSheetHasMeaningfulData(state?.notesSheet)||!!state?.rightsLastCalculatedDate||bank.currentBalance!==null&&bank.currentBalance!==undefined
    ||Array.isArray(bank.adjustments)&&bank.adjustments.length||Array.isArray(credit.profiles)&&credit.profiles.length
}
