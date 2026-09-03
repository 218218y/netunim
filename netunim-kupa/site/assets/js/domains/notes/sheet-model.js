export const NOTES_SHEET_MIN_WIDTH=110;
export const NOTES_SHEET_MAX_WIDTH=520;
export const NOTES_SHEET_DEFAULT_WIDTH=180;
const DEFAULT_COLUMN_COUNT=5;

export function defaultNotesSheetColumns(){
  return Array.from({length:DEFAULT_COLUMN_COUNT},(_,i)=>({id:`sheet-col-${i+1}`,title:`עמודה ${i+1}`,type:'text',width:NOTES_SHEET_DEFAULT_WIDTH}));
}

export function createDefaultNotesSheet(){return {version:1,columns:defaultNotesSheetColumns(),rows:[]}}

export function clampNotesSheetWidth(value){
  const n=Math.round(Number(value)||NOTES_SHEET_DEFAULT_WIDTH);
  return Math.min(NOTES_SHEET_MAX_WIDTH,Math.max(NOTES_SHEET_MIN_WIDTH,n));
}

export function normalizeNotesSheet(source){
  const raw=source&&typeof source==='object'&&!Array.isArray(source)?source:{};
  const incoming=Array.isArray(raw.columns)&&raw.columns.length?raw.columns:defaultNotesSheetColumns();
  const columns=[],columnIds=new Set();
  for(let i=0;i<incoming.length;i++){
    const item=incoming[i]&&typeof incoming[i]==='object'?incoming[i]:{};
    const id=String(item.id||'').trim();
    if(!id||columnIds.has(id))continue;
    columnIds.add(id);
    columns.push({id,title:String(item.title||`עמודה ${columns.length+1}`).trim()||`עמודה ${columns.length+1}`,type:item.type==='number'?'number':'text',width:clampNotesSheetWidth(item.width)});
  }
  if(!columns.length)return createDefaultNotesSheet();
  const rows=[],rowIds=new Set();
  for(const item of Array.isArray(raw.rows)?raw.rows:[]){
    if(!item||typeof item!=='object')continue;
    const id=String(item.id||'').trim();
    if(!id||rowIds.has(id))continue;
    rowIds.add(id);
    const sourceCells=item.cells&&typeof item.cells==='object'&&!Array.isArray(item.cells)?item.cells:{};
    const cells={};
    for(const column of columns)if(Object.prototype.hasOwnProperty.call(sourceCells,column.id))cells[column.id]=String(sourceCells[column.id]??'');
    rows.push({id,cells,createdAt:String(item.createdAt||''),updatedAt:String(item.updatedAt||item.createdAt||'')});
  }
  return {version:1,columns,rows};
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
  const normalized=normalizeNotesSheet(sheet);
  let total=0;
  for(const row of normalized.rows){const value=sheetNumericValue(row.cells?.[columnId]);if(value!==null)total+=value}
  return total;
}

export function formatSheetNumber(value){
  const n=Number(value||0);
  return new Intl.NumberFormat('he-IL',{maximumFractionDigits:2}).format(Number.isFinite(n)?n:0);
}

export function notesSheetHasMeaningfulData(source){
  if(!source||typeof source!=='object'||Array.isArray(source))return false;
  const normalized=normalizeNotesSheet(source),defaults=createDefaultNotesSheet();
  return normalized.rows.length>0||JSON.stringify(normalized.columns)!==JSON.stringify(defaults.columns);
}
