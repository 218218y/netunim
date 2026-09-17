import {createDefaultNotesSheet,normalizeNotesSheet} from './notes-sheet-model.js';
import {equalSyncJson} from './cloud-sync.js';
import {createNotesWorkbookMerger} from './notes-workbook-merge.js';

const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
export function assertSpreadsheet(book){
  const fail=path=>{throw new Error(`נתוני הגליון אינם תקינים (${path}). השמירה נעצרה; הנתונים המקוריים נשמרו להתאוששות.`)};
  if(!object(book)||book.version!==2)fail('version');
  const ids=new Set(),sheets=new Set(),columns=new Map();
  for(const part of ['sheets','columns','rows']){
    if(!Array.isArray(book[part]))fail(part);
    for(const row of book[part]){if(!object(row)||typeof row.id!=='string'||!row.id.trim()||ids.has(row.id))fail(`${part}.id`);ids.add(row.id)}
  }
  if(!book.sheets.length)fail('sheets');
  for(const sheet of book.sheets){if(typeof sheet.name!=='string'||!sheet.name.trim())fail('sheet.name');sheets.add(sheet.id)}
  for(const column of book.columns){
    if(!sheets.has(column.sheetId)||!['text','number'].includes(column.type)||typeof column.title!=='string'||!Number.isInteger(column.width)||column.width<70||column.width>520)fail(`columns.${column.id}`);
    columns.set(column.id,column.sheetId);
  }
  for(const id of sheets)if(!book.columns.some(column=>column.sheetId===id))fail(`sheets.${id}.columns`);
  for(const row of book.rows){
    if(!sheets.has(row.sheetId)||!object(row.cells))fail(`rows.${row.id}`);
    for(const [key,value] of Object.entries(row.cells))if(columns.get(key)!==row.sheetId||typeof value!=='string')fail(`rows.${row.id}.cells.${key}`);
  }
  return book;
}

// The legacy upgrade is explicit and checks every source cell before accepting
// normalization. It must never silently drop a cell or repair a duplicate ID.
export function migrateLegacySpreadsheet(source){
  if(source===undefined||source===null)return createDefaultNotesSheet();
  if(!object(source)||!Array.isArray(source.columns)||!Array.isArray(source.rows))throw new Error('invalid_legacy_workbook');
  for(const part of ['sheets','columns','rows']){
    const rows=source[part]||[],ids=new Set();
    if(!Array.isArray(rows))throw new Error('invalid_legacy_workbook');
    for(const row of rows){if(!object(row)||typeof row.id!=='string'||!row.id||ids.has(row.id))throw new Error('invalid_legacy_id');ids.add(row.id)}
  }
  const columns=new Map(source.columns.map(column=>[column.id,column]));
  for(const row of source.rows){
    if(!object(row.cells))throw new Error('invalid_legacy_cells');
    for(const key of Object.keys(row.cells))if(!columns.has(key)||Number(source.version)>=2&&columns.get(key).sheetId!==row.sheetId)throw new Error('orphan_legacy_cell');
  }
  if(Number(source.version)>=2){
    const sheets=new Set((source.sheets||[]).map(sheet=>sheet.id));
    if(!sheets.size||[...source.rows,...source.columns].some(row=>!sheets.has(row.sheetId)))throw new Error('orphan_legacy_sheet');
  }
  for(const column of source.columns)if(column.type!==undefined&&!['text','number'].includes(column.type)||Number(source.version)>=2&&column.width!==undefined&&(!Number.isInteger(column.width)||column.width<70||column.width>520))throw new Error('invalid_legacy_column');
  return assertSpreadsheet(normalizeNotesSheet(source));
}

function mergeRecords(base=[],local=[],remote=[],key,path,conflicts){
  const maps=[base,local,remote].map(rows=>new Map(rows.map(row=>[row[key],row]))),out=[];
  // Preserve locally inserted positions; append remote-only records in their order.
  const order=equalSyncJson(base.map(row=>row[key]),local.map(row=>row[key]))?remote:local;
  const ids=new Set([...order.map(row=>row[key]),...remote.map(row=>row[key]),...base.map(row=>row[key])]);
  for(const id of ids){
    const [b,l,r]=maps.map(map=>map.get(id));
    if(equalSyncJson(l,b)){if(r)out.push(structuredClone(r));continue}
    if(equalSyncJson(r,b)||equalSyncJson(l,r)){if(l)out.push(structuredClone(l));continue}
    if(!b||!l||!r){conflicts.push(`${path}:${id}`);continue}
    const row={};
    for(const field of new Set([...Object.keys(b),...Object.keys(l),...Object.keys(r)])){
      if(field==='updatedAt'){row[field]=[b[field],l[field],r[field]].filter(Boolean).sort().at(-1)||'';continue}
      if(field==='cells'){
        row.cells={};for(const cell of new Set([...Object.keys(b.cells),...Object.keys(l.cells),...Object.keys(r.cells)])){
          const value=mergeField(b.cells[cell],l.cells[cell],r.cells[cell],`${path}:${id}.cells.${cell}`,conflicts);if(value!==undefined)row.cells[cell]=value;
        }
      }else{const value=mergeField(b[field],l[field],r[field],`${path}:${id}.${field}`,conflicts);if(value!==undefined)row[field]=value}
    }
    out.push(row);
  }
  return out;
}
function mergeField(b,l,r,path,conflicts){if(!equalSyncJson(l,b)&&!equalSyncJson(r,b)&&!equalSyncJson(l,r)){conflicts.push(path);return r}return equalSyncJson(l,b)?r:l}
const mergeBook=createNotesWorkbookMerger({clone:structuredClone,jsonEq:equalSyncJson,mergeRecordArray:mergeRecords});
export function mergeSpreadsheets(base,local,remote,deleteIntents={}){
  [base,local,remote].forEach(assertSpreadsheet);const conflicts=[];
  const state=mergeBook(base,local,remote,deleteIntents,conflicts);
  if(!conflicts.length)assertSpreadsheet(state);
  return {state,conflicts};
}
export function spreadsheetDeleteIntents(before,after){
  const result={};for(const part of ['sheets','rows','columns']){const kept=new Set(after[part].map(row=>row.id)),ids=before[part].map(row=>row.id).filter(id=>!kept.has(id));if(ids.length)result[`notesSheet.${part}`]=ids}return result;
}
