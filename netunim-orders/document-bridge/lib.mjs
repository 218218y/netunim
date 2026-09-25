import path from 'node:path';

export const BRIDGE_PORT=8766;
export const BRIDGE_SERVICE='netunim-orders-document-bridge';
export const BRIDGE_VERSION=1;
export const MAX_QUERY_CHARS=160;
export const MAX_QUERY_TERMS=12;
export const MAX_RESULTS=80;
export const DEFAULT_RESULT_LIMIT=40;
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

function everythingLiteral(value){
  return String(value??'').replaceAll('"','&quot:');
}

export function normalizeSearchText(value){
  return String(value??'').replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,MAX_QUERY_CHARS);
}

export function buildContentQuery(value){
  const normalized=normalizeSearchText(value);
  if(normalized.length<2)return '';
  const terms=normalized.split(' ').filter(Boolean).slice(0,MAX_QUERY_TERMS);
  if(!terms.length)return '';
  return `ext:pdf ${terms.map(term=>`content:"${everythingLiteral(term)}"`).join(' ')}`;
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

export function buildEsSearchArgs({root,query,limit=DEFAULT_RESULT_LIMIT,timeoutMs=6000,instance=''}){
  const rootPath=normalizeWindowsPath(root?.path||root);
  const search=buildContentQuery(query);
  if(!rootPath)throw new TypeError('Document root is required');
  if(!search)throw new TypeError('Search query must contain at least two characters');
  const count=Math.max(1,Math.min(MAX_RESULTS,Number(limit)||DEFAULT_RESULT_LIMIT));
  const timeout=Math.max(1500,Math.min(15000,Number(timeoutMs)||6000));
  return ['-ipc3',...(instance?['-instance',String(instance)]:[]),'-timeout',String(timeout),'-json','-no-folder-append-path-separator','-date-format','3','-size-format','1','-no-digit-grouping','-name','-path-column','-size','-date-modified','-sort','date-modified-descending','-n',String(count),'-path',rootPath,'/a-d',search];
}

export function parseEsJson(stdout,{root}={}){
  const raw=String(stdout??'').replace(/^\uFEFF/,'').trim();
  if(!raw)return [];
  let parsed;
  try{parsed=JSON.parse(raw)}catch(error){const e=new Error('ES returned invalid JSON');e.code='ES_INVALID_JSON';e.cause=error;throw e}
  const rootPath=normalizeWindowsPath(root?.path||'');
  return jsonRows(parsed).map(row=>{
    const name=text(field(row,['name','filename','file name']));
    const parent=normalizeWindowsPath(field(row,['path','parent path','parent_path']));
    const direct=normalizeWindowsPath(field(row,['full path and name','full-path-and-name','filename column','fullpath','full path']));
    const fullPath=direct||(parent&&name?path.win32.join(parent,name):'');
    if(!fullPath||!name||!name.toLowerCase().endsWith('.pdf'))return null;
    if(rootPath&&!pathInsideRoot(fullPath,rootPath))return null;
    const relative=rootPath?path.win32.relative(rootPath,fullPath):name;
    const relativeDir=path.win32.dirname(relative)==='.'?'':path.win32.dirname(relative);
    const modified=text(field(row,['date modified','date-modified','datemodified','dm']));
    const sizeRaw=field(row,['size']);
    const size=Number(String(sizeRaw??'').replace(/[,_\s]/g,''));
    return {name,fullPath,relativePath:relativeDir,modified,size:Number.isFinite(size)?size:null,rootId:root?.id||'',rootLabel:root?.label||''};
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

function wildcardToRegExp(pattern){
  const escaped=String(pattern||'').replace(/[.+?^${}()|[\]\\]/g,'\\$&').replaceAll('*','.*');
  return new RegExp(`^${escaped}$`,'i');
}
export function originAllowed(origin,patterns=DEFAULT_ALLOWED_ORIGINS){
  if(!origin)return true;
  return (Array.isArray(patterns)?patterns:[]).some(pattern=>wildcardToRegExp(pattern).test(origin));
}
