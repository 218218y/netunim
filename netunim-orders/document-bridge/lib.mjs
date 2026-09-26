import path from 'node:path';

export const BRIDGE_PORT=8766;
export const BRIDGE_SERVICE='netunim-orders-document-bridge';
export const BRIDGE_VERSION=4;
export const MAX_QUERY_CHARS=240;
export const MAX_RESULTS=120;
export const DEFAULT_RESULT_LIMIT=60;
export const RESULT_TTL_MS=10*60*1000;
export const DEFAULT_ALLOWED_ORIGINS=[
  'https://bargig-furniture.com',
  'https://*.bargig-furniture.com',
  'https://bargig-orders.pages.dev',
  'https://*.bargig-orders.pages.dev',
  'http://localhost:*',
  'http://127.0.0.1:*',
];

function text(value){return String(value??'').trim()}

export function normalizeWindowsPath(value){
  let candidate=text(value).replace(/^"|"$/g,'');
  if(!candidate)return '';
  candidate=candidate.replaceAll('/','\\');
  const parsed=path.win32.parse(candidate);
  while(candidate.length>parsed.root.length&&/[\\/]$/.test(candidate))candidate=candidate.slice(0,-1);
  return candidate;
}

export function pathInsideRoot(filePath,rootPath){
  const file=normalizeWindowsPath(filePath),root=normalizeWindowsPath(rootPath);
  if(!file||!root)return false;
  const relative=path.win32.relative(root,file);
  return relative===''||(!relative.startsWith('..\\')&&relative!=='..'&&!path.win32.isAbsolute(relative));
}

export function makeRootLabel(rootPath,index=0){
  const root=normalizeWindowsPath(rootPath);
  if(!root)return `תיקייה ${index+1}`;
  const base=path.win32.basename(root);
  if(base)return base;
  const parsed=path.win32.parse(root);
  return parsed.root.replace(/[\\]+$/,'')||`תיקייה ${index+1}`;
}

export function normalizeRoots(input){
  const seen=new Set(),rows=[];
  for(const [index,item] of (Array.isArray(input)?input:[]).entries()){
    const source=typeof item==='string'?{path:item}:item||{};
    const rootPath=normalizeWindowsPath(source.path);
    if(!rootPath)continue;
    const key=rootPath.toLocaleLowerCase('en-US');
    if(seen.has(key))continue;
    seen.add(key);
    rows.push({id:text(source.id)||`root-${rows.length+1}`,label:text(source.label)||makeRootLabel(rootPath,index),path:rootPath});
  }
  return rows;
}

function everythingLiteral(value){return String(value??'').replaceAll('"','&quot:')}

export function normalizeSearchText(value){
  return String(value??'').replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,MAX_QUERY_CHARS);
}

export function normalizeDocumentSearchMode(value){return value==='content'?'content':'everything'}

export function buildContentQuery(value){
  const normalized=normalizeSearchText(value);
  if(normalized.length<2)return '';
  // Match the same content: function used by Everything itself. When content
  // indexing is enabled Everything uses it; otherwise Everything applies its
  // normal on-disk content behavior. no-background-search makes ES wait for
  // the completed result set instead of returning while content work continues.
  return `content:"${everythingLiteral(normalized)}" no-background-search:`;
}

export function buildEverythingQuery(value){
  // This mode intentionally mirrors the Everything search box. Operators,
  // filters and Everything syntax entered by the user are preserved.
  return normalizeSearchText(value);
}

export function buildNameQuery(value){return buildEverythingQuery(value)}

export function buildDocumentQuery(value,mode='everything'){
  return normalizeDocumentSearchMode(mode)==='content'?buildContentQuery(value):buildEverythingQuery(value);
}

function normalizedKey(value){return String(value??'').toLowerCase().replace(/[\s_-]+/g,'')}
function field(row,names){
  if(!row||typeof row!=='object')return '';
  const wanted=new Set(names.map(normalizedKey));
  for(const [key,value] of Object.entries(row))if(wanted.has(normalizedKey(key)))return value;
  return '';
}
function jsonRows(parsed){
  if(Array.isArray(parsed))return parsed;
  if(!parsed||typeof parsed!=='object')return [];
  for(const name of ['results','items','files'])if(Array.isArray(parsed[name]))return parsed[name];
  const firstArray=Object.values(parsed).find(Array.isArray);
  return Array.isArray(firstArray)?firstArray:[];
}

function commonEsPrefix({timeoutMs=15000,instance=''}){
  const timeout=Math.max(3000,Math.min(30000,Number(timeoutMs)||15000));
  // ES writes redirected/pipe output using its console code page. Force UTF-8
  // and use CommandLineToArgvW parsing so both query input and JSON output keep
  // Hebrew/Unicode intact when Node communicates through pipes on Windows.
  return ['-argv','-cp','65001','-ipc3',...(instance?['-instance',String(instance)]:[]),'-timeout',String(timeout)];
}

function displayArgs({limit=DEFAULT_RESULT_LIMIT}){
  const count=Math.max(1,Math.min(MAX_RESULTS,Number(limit)||DEFAULT_RESULT_LIMIT));
  return ['-json','-no-folder-append-path-separator','-date-format','3','-size-format','1','-no-digit-grouping','-name','-path-column','-size','-date-modified','-sort','date-modified-descending','-n',String(count)];
}

export function buildEsRawSearchArgs({search,limit=DEFAULT_RESULT_LIMIT,timeoutMs=15000,instance='',filesOnly=false}){
  if(!String(search??'').trim())throw new TypeError('Search expression is required');
  return [...commonEsPrefix({timeoutMs,instance}),...displayArgs({limit}),...(filesOnly?['/a-d']:[]),'-search',String(search)];
}

export function buildEsSearchArgs({query,mode='everything',limit=DEFAULT_RESULT_LIMIT,timeoutMs=15000,instance=''}){
  const normalizedMode=normalizeDocumentSearchMode(mode),search=buildDocumentQuery(query,normalizedMode);
  if(!search)throw new TypeError('Search query must contain at least two characters');
  return buildEsRawSearchArgs({search,limit,timeoutMs,instance,filesOnly:normalizedMode==='content'});
}

export function buildEsCountArgs({search='*',timeoutMs=15000,instance='',filesOnly=true}){
  if(!text(search))throw new TypeError('Search expression is required');
  return [...commonEsPrefix({timeoutMs,instance}),'-no-digit-grouping',...(filesOnly?['/a-d']:[]),'-get-result-count','-search',String(search)];
}

export function parseEsCount(stdout){
  const raw=String(stdout??'').replace(/^\uFEFF/,'').trim();
  const match=raw.match(/-?\d+/);
  const value=match?Number(match[0]):NaN;
  if(!Number.isSafeInteger(value)||value<0){const error=new Error(`ES returned an invalid result count: ${raw||'(empty)'}`);error.code='ES_INVALID_COUNT';throw error}
  return value;
}

export function parseEsJson(stdout){
  const raw=String(stdout??'').replace(/^\uFEFF/,'').trim();
  if(!raw)return [];
  let parsed;
  try{parsed=JSON.parse(raw)}catch(error){const e=new Error('ES returned invalid JSON');e.code='ES_INVALID_JSON';e.cause=error;throw e}
  return jsonRows(parsed).map(row=>{
    const name=text(field(row,['name','filename','file name']));
    const parent=normalizeWindowsPath(field(row,['path','parent path','parent_path']));
    const direct=normalizeWindowsPath(field(row,['full path and name','full-path-and-name','filename column','fullpath','full path']));
    const fullPath=direct||(parent&&name?path.win32.join(parent,name):'');
    if(!fullPath||!name)return null;
    const modified=text(field(row,['date modified','date-modified','datemodified','date_modified','dm']));
    const sizeRaw=field(row,['size']);
    const size=Number(String(sizeRaw??'').replace(/[,_\s]/g,''));
    const extension=path.win32.extname(name).replace(/^\./,'').toLowerCase();
    return {name,fullPath,relativePath:parent,modified,size:Number.isFinite(size)?size:null,extension,rootId:'everything',rootLabel:'Everything'};
  }).filter(Boolean);
}

export function mergeDocumentResults(groups,limit=DEFAULT_RESULT_LIMIT){
  const deduped=new Map();
  for(const group of Array.isArray(groups)?groups:[]){
    for(const row of Array.isArray(group)?group:[]){
      const key=normalizeWindowsPath(row?.fullPath).toLocaleLowerCase('en-US');
      if(!key||deduped.has(key))continue;
      deduped.set(key,row);
    }
  }
  const rows=[...deduped.values()].sort((a,b)=>{
    const ad=Date.parse(a.modified||''),bd=Date.parse(b.modified||'');
    if(Number.isFinite(ad)||Number.isFinite(bd))return (Number.isFinite(bd)?bd:0)-(Number.isFinite(ad)?ad:0);
    return String(a.name||'').localeCompare(String(b.name||''),'he');
  });
  return rows.slice(0,Math.max(1,Math.min(MAX_RESULTS,Number(limit)||DEFAULT_RESULT_LIMIT)));
}

export function parseRegistryInstallLocation(stdout,valueName='InstallLocation'){
  const wanted=String(valueName||'InstallLocation').toLowerCase();
  for(const line of String(stdout??'').split(/\r?\n/)){
    const trimmed=line.trim();
    if(!trimmed.toLowerCase().startsWith(wanted))continue;
    const match=trimmed.match(/^\S+\s+REG_(?:SZ|EXPAND_SZ)\s+(.+)$/i);
    if(match?.[1])return match[1].trim();
  }
  return '';
}

function wildcardToRegExp(pattern){
  const escaped=String(pattern||'').replace(/[.+?^${}()|[\]\\]/g,'\\$&').replaceAll('*','.*');
  return new RegExp(`^${escaped}$`,'i');
}
export function originAllowed(origin,patterns=DEFAULT_ALLOWED_ORIGINS){
  if(!origin)return true;
  return (Array.isArray(patterns)?patterns:[]).some(pattern=>wildcardToRegExp(pattern).test(origin));
}
