export const NOTES_SHEET_MIN_WIDTH=70;
export const NOTES_SHEET_MAX_WIDTH=520;
export const NOTES_SHEET_DEFAULT_WIDTH=90;
export const NOTES_SHEET_DEFAULT_ID='sheet-main';
const DEFAULT_COLUMN_COUNT=5;
const LEGACY_AUTO_SHEET_PREFIX='\u05d2\u05d9\u05dc\u05d9\u05d5\u05df';

export function defaultNotesSheetColumns(sheetId=NOTES_SHEET_DEFAULT_ID){
  return Array.from({length:DEFAULT_COLUMN_COUNT},(_,i)=>({id:`${sheetId}-col-${i+1}`,sheetId,title:`עמודה ${i+1}`,type:'text',width:NOTES_SHEET_DEFAULT_WIDTH}));
}

export function createDefaultNotesSheet(){return {version:2,sheets:[{id:NOTES_SHEET_DEFAULT_ID,name:'גליון 1'}],columns:defaultNotesSheetColumns(),rows:[]}}

export function clampNotesSheetWidth(value){
  const n=Math.round(Number(value)||NOTES_SHEET_DEFAULT_WIDTH);
  return Math.min(NOTES_SHEET_MAX_WIDTH,Math.max(NOTES_SHEET_MIN_WIDTH,n));
}

function normalizedSheetName(value,index){
  const name=String(value||'').trim();
  if(!name)return `גליון ${index+1}`;
  const legacy=name.match(new RegExp(`^${LEGACY_AUTO_SHEET_PREFIX}\\s+(\\d+)$`));
  return legacy?`גליון ${legacy[1]}`:name;
}
function uniqueId(value,fallback,used){let id=String(value||'').trim()||fallback,n=2;while(used.has(id))id=`${fallback}-${n++}`;used.add(id);return id}

export function normalizeNotesSheet(source){
  const raw=source&&typeof source==='object'&&!Array.isArray(source)?source:{},isWorkbook=Number(raw.version)>=2&&Array.isArray(raw.sheets)&&raw.sheets.length>0;
  const sheetIds=new Set(),sheets=[];
  if(isWorkbook){
    for(let i=0;i<raw.sheets.length;i++){
      const item=raw.sheets[i]&&typeof raw.sheets[i]==='object'?raw.sheets[i]:{};
      const id=uniqueId(item.id,`sheet-${i+1}`,sheetIds);sheets.push({id,name:normalizedSheetName(item.name,i)});
    }
  }else{sheets.push({id:NOTES_SHEET_DEFAULT_ID,name:'גליון 1'});sheetIds.add(NOTES_SHEET_DEFAULT_ID)}
  const primarySheetId=sheets[0].id,columnIds=new Set(),columns=[];
  const incoming=Array.isArray(raw.columns)&&raw.columns.length?raw.columns:(isWorkbook?[]:defaultNotesSheetColumns(primarySheetId));
  for(let i=0;i<incoming.length;i++){
    const item=incoming[i]&&typeof incoming[i]==='object'?incoming[i]:{},sheetId=isWorkbook&&sheetIds.has(String(item.sheetId||''))?String(item.sheetId):primarySheetId;
    const id=uniqueId(item.id,`${sheetId}-col-${i+1}`,columnIds);
    // Legacy v1 widths are intentionally reset to the new compact default.
    const width=isWorkbook?clampNotesSheetWidth(item.width):NOTES_SHEET_DEFAULT_WIDTH;
    columns.push({id,sheetId,title:String(item.title||`עמודה ${columns.length+1}`).trim()||`עמודה ${columns.length+1}`,type:item.type==='number'?'number':'text',width});
  }
  for(const sheet of sheets)if(!columns.some(column=>column.sheetId===sheet.id)){
    for(const column of defaultNotesSheetColumns(sheet.id))columns.push({...column,id:uniqueId(column.id,`${sheet.id}-col-${columnIds.size+1}`,columnIds),title:`עמודה ${columns.filter(x=>x.sheetId===sheet.id).length+1}`});
  }
  const rows=[],rowIds=new Set();
  for(const item of Array.isArray(raw.rows)?raw.rows:[]){
    if(!item||typeof item!=='object')continue;
    const id=uniqueId(item.id,`sheet-row-${rowIds.size+1}`,rowIds),sheetId=isWorkbook&&sheetIds.has(String(item.sheetId||''))?String(item.sheetId):primarySheetId;
    const sourceCells=item.cells&&typeof item.cells==='object'&&!Array.isArray(item.cells)?item.cells:{},cells={},allowed=new Set(columns.filter(column=>column.sheetId===sheetId).map(column=>column.id));
    for(const [columnId,value] of Object.entries(sourceCells))if(allowed.has(columnId))cells[columnId]=String(value??'');
    rows.push({id,sheetId,cells,createdAt:String(item.createdAt||''),updatedAt:String(item.updatedAt||item.createdAt||'')});
  }
  return {version:2,sheets,columns,rows};
}

export function notesSheetById(source,sheetId=''){
  const book=normalizeNotesSheet(source),meta=book.sheets.find(sheet=>sheet.id===sheetId)||book.sheets[0];
  return {book,meta,columns:book.columns.filter(column=>column.sheetId===meta.id),rows:book.rows.filter(row=>row.sheetId===meta.id)};
}

export function sheetNumericValue(value){
  if(typeof value==='number')return Number.isFinite(value)?value:null;
  let raw=String(value??'').trim();
  if(!raw)return null;
  let negative=false;
  if(/^\(.*\)$/.test(raw)){negative=true;raw=raw.slice(1,-1)}
  raw=raw.replace(/[\s\u00a0₪]/g,'').replace(/,/g,'');
  if(!/^[-+]?\d+(?:\.\d+)?$/.test(raw))return null;
  const n=Number(raw);if(!Number.isFinite(n))return null;
  return negative?-Math.abs(n):n;
}

export function sheetColumnTotal(sheet,columnId){
  let total=0;
  for(const row of Array.isArray(sheet?.rows)?sheet.rows:[]){const value=sheetNumericValue(row.cells?.[columnId]);if(value!==null)total+=value}
  return total;
}

export function formatSheetNumber(value){
  const n=Number(value||0);
  return new Intl.NumberFormat('he-IL',{maximumFractionDigits:2}).format(Number.isFinite(n)?n:0);
}

export function notesSheetHasMeaningfulData(source){
  if(!source||typeof source!=='object'||Array.isArray(source))return false;
  const normalized=normalizeNotesSheet(source),defaults=createDefaultNotesSheet();
  return normalized.rows.length>0||normalized.sheets.length>1||normalized.sheets[0]?.name!==defaults.sheets[0].name||JSON.stringify(normalized.columns)!==JSON.stringify(defaults.columns);
}
