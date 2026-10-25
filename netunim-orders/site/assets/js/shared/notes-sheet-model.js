/** @param {unknown} value @returns {value is Record<string,unknown>} */
function record(value){return value!==null&&typeof value==='object'}
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

/** @param {unknown} value */
export function clampNotesSheetWidth(value){
  const n=Math.round(Number(value)||NOTES_SHEET_DEFAULT_WIDTH);
  return Math.min(NOTES_SHEET_MAX_WIDTH,Math.max(NOTES_SHEET_MIN_WIDTH,n));
}

/** @param {unknown} value @param {number} index */
function normalizedSheetName(value,index){
  const name=String(value||'').trim();
  if(!name)return `גליון ${index+1}`;
  const legacy=name.match(new RegExp(`^${LEGACY_AUTO_SHEET_PREFIX}\\s+(\\d+)$`));
  return legacy?`גליון ${legacy[1]}`:name;
}
/** @param {unknown} value @param {string} fallback @param {Set<string>} used */
function uniqueId(value,fallback,used){let id=String(value||'').trim()||fallback,n=2;while(used.has(id))id=`${fallback}-${n++}`;used.add(id);return id}

/** @param {unknown} source */
export function normalizeNotesSheet(source){
  const raw=record(source)&&!Array.isArray(source)?source:{};
  /** @type {unknown[]} */ const inputSheets=Array.isArray(raw.sheets)?raw.sheets:[];
  const isWorkbook=Number(raw.version)>=2&&inputSheets.length>0;
  const sheetIds=new Set(),sheets=[];
  if(isWorkbook){
    for(let i=0;i<inputSheets.length;i++){
      const candidate=inputSheets[i],item=record(candidate)?candidate:{};
      const id=uniqueId(item.id,`sheet-${i+1}`,sheetIds);sheets.push({id,name:normalizedSheetName(item.name,i)});
    }
  }else{sheets.push({id:NOTES_SHEET_DEFAULT_ID,name:'גליון 1'});sheetIds.add(NOTES_SHEET_DEFAULT_ID)}
  const primarySheetId=sheets[0]?.id||NOTES_SHEET_DEFAULT_ID,columnIds=new Set(),columns=[];
  /** @type {unknown[]} */ const incoming=Array.isArray(raw.columns)&&raw.columns.length?raw.columns:(isWorkbook?[]:defaultNotesSheetColumns(primarySheetId));
  for(let i=0;i<incoming.length;i++){
    const candidate=incoming[i],item=record(candidate)?candidate:{},sheetId=isWorkbook&&sheetIds.has(String(item.sheetId||''))?String(item.sheetId):primarySheetId;
    const id=uniqueId(item.id,`${sheetId}-col-${i+1}`,columnIds);
    // Legacy v1 widths are intentionally reset to the new compact default.
    const width=isWorkbook?clampNotesSheetWidth(item.width):NOTES_SHEET_DEFAULT_WIDTH;
    columns.push({id,sheetId,title:String(item.title||`עמודה ${columns.length+1}`).trim()||`עמודה ${columns.length+1}`,type:item.type==='number'?'number':'text',width});
  }
  for(const sheet of sheets)if(!columns.some(column=>column.sheetId===sheet.id)){
    for(const column of defaultNotesSheetColumns(sheet.id))columns.push({...column,id:uniqueId(column.id,`${sheet.id}-col-${columnIds.size+1}`,columnIds),title:`עמודה ${columns.filter(x=>x.sheetId===sheet.id).length+1}`});
  }
  const rows=[],rowIds=new Set();
  for(const item of /** @type {unknown[]} */ (Array.isArray(raw.rows)?raw.rows:[])){
    if(!record(item))continue;
    const id=uniqueId(item.id,`sheet-row-${rowIds.size+1}`,rowIds),sheetId=isWorkbook&&sheetIds.has(String(item.sheetId||''))?String(item.sheetId):primarySheetId;
    const sourceCells=record(item.cells)&&!Array.isArray(item.cells)?item.cells:{},cells=/** @type {Record<string,string>} */ ({}),allowed=new Set(columns.filter(column=>column.sheetId===sheetId).map(column=>column.id));
    for(const [columnId,value] of Object.entries(sourceCells))if(allowed.has(columnId))cells[columnId]=String(value??'');
    rows.push({id,sheetId,cells,createdAt:String(item.createdAt||''),updatedAt:String(item.updatedAt||item.createdAt||'')});
  }
  return {version:2,sheets,columns,rows};
}

/** @param {unknown} source @param {string} [sheetId] */
export function notesSheetById(source,sheetId=''){
  const book=normalizeNotesSheet(source),meta=book.sheets.find(sheet=>sheet.id===sheetId)||book.sheets[0];
  if(!meta)throw new Error('notes_sheet_missing');
  return {book,meta,columns:book.columns.filter(column=>column.sheetId===meta.id),rows:book.rows.filter(row=>row.sheetId===meta.id)};
}

/** @param {unknown} value */
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

/** @param {{rows?:{cells?:Record<string,unknown>}[]}|null|undefined} sheet @param {string} columnId */
export function sheetColumnTotal(sheet,columnId){
  let total=0;
  for(const row of Array.isArray(sheet?.rows)?sheet.rows:[]){const value=sheetNumericValue(row.cells?.[columnId]);if(value!==null)total+=value}
  return total;
}

/** @param {unknown} value */
export function formatSheetNumber(value){
  const n=Number(value||0);
  return new Intl.NumberFormat('he-IL',{maximumFractionDigits:2}).format(Number.isFinite(n)?n:0);
}

/** @param {unknown} source */
export function notesSheetHasMeaningfulData(source){
  if(!source||typeof source!=='object'||Array.isArray(source))return false;
  const normalized=normalizeNotesSheet(source),defaults=createDefaultNotesSheet();
  return normalized.rows.length>0||normalized.sheets.length>1||normalized.sheets[0]?.name!==defaults.sheets[0]?.name||JSON.stringify(normalized.columns)!==JSON.stringify(defaults.columns);
}

/** @param {number} index */
export function sheetColumnLabel(index){
  let label='';for(let n=index+1;n>0;n=Math.floor((n-1)/26))label=String.fromCharCode(65+(n-1)%26)+label;return label;
}

// Excel's text clipboard uses TSV with quoted multiline cells and doubled quotes.
/** @param {unknown} text */
export function parseSheetClipboard(text){
  const source=String(text).replace(/\r\n?/g,'\n'),rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<source.length;i++){
    const ch=source[i];
    if(ch==='"'&&(quoted||cell==='')){if(quoted&&source[i+1]==='"'){cell+='"';i++}else quoted=!quoted;continue}
    if(!quoted&&(ch==='\t'||ch==='\n')){row.push(cell);cell='';if(ch==='\n'){rows.push(row);row=[]}}else cell+=ch;
  }
  if(cell!==''||row.length||!rows.length){row.push(cell);rows.push(row)}
  return rows;
}
