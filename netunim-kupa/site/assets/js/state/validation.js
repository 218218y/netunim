import {notesSheetHasMeaningfulData} from '../domains/notes/sheet-model.js';
import {assertEntityCollection,assertEntityCollections} from '../shared/data-invariants.js';

export const KUPA_ENTITY_COLLECTIONS=Object.freeze(['credits','cash','rights','notes','expenses','cards','notesSheet.rows','notesSheet.columns']);

export function assertKupaEntityInvariants(state,{includeChecks=false,required=false,allowLegacyCards=false}={}){
  const paths=KUPA_ENTITY_COLLECTIONS.filter(path=>path!=='cards');assertEntityCollections(state,includeChecks?[...paths,'checks']:paths,{required});
  if(Array.isArray(state?.cards)&&allowLegacyCards){
    const migrated=state.cards.filter(card=>card?.id!==undefined);assertEntityCollection(migrated,'cards');
  }else assertEntityCollection(state?.cards,'cards',{required});
  return state;
}

function validNotesSheet(value){return value===undefined||!!(value&&typeof value==='object'&&!Array.isArray(value)&&Array.isArray(value.columns)&&value.columns.length>0&&Array.isArray(value.rows)&&value.columns.every(column=>column&&typeof column==='object'&&String(column.id||'').trim())&&value.rows.every(row=>row&&typeof row==='object'&&String(row.id||'').trim()&&row.cells&&typeof row.cells==='object'&&!Array.isArray(row.cells)))}

export function validState(state){
  try{return !!(state&&Array.isArray(state.checks)&&Array.isArray(state.credits)&&Array.isArray(state.cash)&&(!Object.hasOwn(state,'rights')||Array.isArray(state.rights))&&(!Object.hasOwn(state,'notes')||Array.isArray(state.notes))&&validNotesSheet(state.notesSheet)&&(state.rightsLastCalculatedDate===undefined||state.rightsLastCalculatedDate===null||typeof state.rightsLastCalculatedDate==='string')&&Array.isArray(state.expenses)&&Array.isArray(state.cards)&&assertKupaEntityInvariants(state,{includeChecks:true,required:false,allowLegacyCards:true}))}catch{return false}
}

export function assertPortablePayload(payload){
  if(!payload||typeof payload!=='object'||Array.isArray(payload)||!validState(payload))throw new Error('מבנה קובץ הנתונים אינו תקין');
  const meta=payload._meta;if(meta!==undefined&&(!meta||typeof meta!=='object'||Array.isArray(meta)))throw new Error('פרטי הגיבוי אינם תקינים');
  if(meta?.format!==undefined&&meta.format!=='kupa-portable')throw new Error('הגיבוי שייך למערכת אחרת');
  for(const [value,max] of [[meta?.schemaVersion,6],[payload.version,4]]){if(value===undefined)continue;const version=Number(value);if(!Number.isInteger(version)||version<1||version>max)throw new Error('גרסת הגיבוי אינה נתמכת; יש לפתוח אותו בגרסת מערכת מתאימה')}
  return payload;
}

export function validKupaCloudState(state,{allowLegacyCards=false,requiredEntities=true}={}){
  try{return !!(state&&typeof state==='object'&&!Array.isArray(state)&&!Object.hasOwn(state,'checks')&&Array.isArray(state.credits)&&Array.isArray(state.cash)&&(!Object.hasOwn(state,'rights')||Array.isArray(state.rights))&&(!Object.hasOwn(state,'notes')||Array.isArray(state.notes))&&validNotesSheet(state.notesSheet)&&(state.rightsLastCalculatedDate===undefined||state.rightsLastCalculatedDate===null||typeof state.rightsLastCalculatedDate==='string')&&Array.isArray(state.expenses)&&Array.isArray(state.cards)&&state.bank&&typeof state.bank==='object'&&!Array.isArray(state.bank)&&Array.isArray(state.bank.adjustments)&&!state.bank.adjustments.some(item=>item?.type==='check_deposit')&&assertKupaEntityInvariants(state,{required:requiredEntities,allowLegacyCards}))}catch{return false}
}

export function assertValidCloudState(state,context='נתוני הקופה'){
  if(!validKupaCloudState(state))throw new Error(`${context} במבנה לא תקין. הסנכרון נעצר כדי למנוע דריסה או אובדן נתונים.`);return state;
}

export function assertReadableCloudState(state,context='נתוני הקופה בענן'){
  if(!validKupaCloudState(state,{allowLegacyCards:true,requiredEntities:false}))throw new Error(`${context} במבנה לא תקין. הסנכרון נעצר כדי למנוע דריסה או אובדן נתונים.`);return state;
}

export function hasMeaningfulState(state){return ['checks','credits','cash','rights','notes','expenses','cards'].some(key=>Array.isArray(state?.[key])&&state[key].length)||notesSheetHasMeaningfulData(state?.notesSheet)||!!state?.rightsLastCalculatedDate||state?.bank?.currentBalance!==null&&state?.bank?.currentBalance!==undefined||Array.isArray(state?.bank?.adjustments)&&state.bank.adjustments.length||Array.isArray(state?.creditSync?.profiles)&&state.creditSync.profiles.length}
