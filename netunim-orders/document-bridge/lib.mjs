import path from 'node:path';

export const BRIDGE_PORT=8766;
export const BRIDGE_SERVICE='netunim-orders-document-bridge';
export const BRIDGE_VERSION=31;
export const MAX_QUERY_CHARS=240;
export const MAX_RESULTS=5000;
export const RECENT_RESULT_LIMIT=150;
export const DEFAULT_RESULT_LIMIT=150;
export const RESULT_TTL_MS=10*60*1000;
export const DEFAULT_ALLOWED_ORIGINS=[
  'https://bargig-furniture.com',
  'https://*.bargig-furniture.com',
  'https://bargig-orders.pages.dev',
  'https://*.bargig-orders.pages.dev',
  'https://bargig-kupa.pages.dev',
  'https://*.bargig-kupa.pages.dev',
  'http://localhost:*',
  'http://127.0.0.1:*',
];

function text(value){return String(value??'').trim()}

const WORD_PREVIEW_EXTENSIONS=new Set(['doc','docx','docm','dot','dotx','dotm','rtf']);
const WORD_STRUCTURED_EXTENSIONS=new Set(['docx','docm','dotx','dotm']);
const EXCEL_PREVIEW_EXTENSIONS=new Set(['xls','xlsx','xlsm','xlsb','xlt','xltx','xltm']);
const POWERPOINT_PREVIEW_EXTENSIONS=new Set(['ppt','pptx','pptm','pps','ppsx','ppsm','pot','potx','potm']);

export function officePreviewKind(extension){
  const ext=String(extension??'').replace(/^\./,'').toLowerCase();
  if(WORD_PREVIEW_EXTENSIONS.has(ext))return 'word';
  if(EXCEL_PREVIEW_EXTENSIONS.has(ext))return 'excel';
  if(POWERPOINT_PREVIEW_EXTENSIONS.has(ext))return 'powerpoint';
  return '';
}

export function structuredPreviewKind(extension){
  const ext=String(extension??'').replace(/^\./,'').toLowerCase();
  if(WORD_STRUCTURED_EXTENSIONS.has(ext))return 'word';
  if(EXCEL_PREVIEW_EXTENSIONS.has(ext))return 'spreadsheet';
  return '';
}


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
function regexLiteral(value){return String(value??'').replace(/[\\^$.*+?()[\]{}|]/g,'\\$&')}

export function normalizeSearchText(value){
  return String(value??'').replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,MAX_QUERY_CHARS);
}

export function normalizeDocumentSearchMode(value){return value==='content'?'content':'everything'}

const CONTENT_MATCH_MODES=new Set(['phrase','all','any','proximity']);
export function normalizeContentSearchOptions(value={}){
  const source=value&&typeof value==='object'?value:{};
  const matchMode=CONTENT_MATCH_MODES.has(source.matchMode)?source.matchMode:'phrase';
  const proximityWords=Math.max(0,Math.min(50,Math.trunc(Number(source.proximityWords) || 0)));
  return {matchMode,proximityWords};
}

function contentTerms(value){
  return normalizeSearchText(value).split(' ').map(term=>term.trim()).filter(Boolean).slice(0,16);
}

const PHONE_QUERY_IGNORED=/[\s\u002d\u2010-\u2015\u2212\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
function phoneSearchDigits(value){
  const raw=String(value??'').trim();if(!raw)return '';
  const digits=raw.replace(PHONE_QUERY_IGNORED,'');
  return /^\d{7,15}$/.test(digits)?digits:'';
}
function phoneSearchRegex(value){
  const digits=phoneSearchDigits(value);if(!digits)return '';
  const separator='(?:\\s|[-‐‑‒–—―−])?';
  const variants=[];
  for(const prefixLength of [2,3])if(digits.length>prefixLength)variants.push(`${regexLiteral(digits.slice(0,prefixLength))}${separator}${regexLiteral(digits.slice(prefixLength))}`);
  return variants.length===1?variants[0]:`(?:${variants.join('|')})`;
}

function buildContentProximityRegex(terms,proximityWords){
  if(terms.length<2)return '';
  const gap=`(?:\\s+\\S+){0,${proximityWords}}\\s+`;
  return terms.map(regexLiteral).join(gap);
}

export function buildContentQuery(value,options={}){
  const normalized=normalizeSearchText(value);
  if(normalized.length<2)return '';
  const phonePattern=phoneSearchRegex(normalized);
  if(phonePattern)return `regex:content:"${everythingLiteral(phonePattern)}" no-background-search:`;
  const search=normalizeContentSearchOptions(options),terms=contentTerms(normalized);
  // Match the same content: function used by Everything itself. When content
  // indexing is enabled Everything uses it; otherwise Everything applies its
  // normal on-disk content behavior. no-background-search makes ES wait for
  // the completed result set instead of returning while content work continues.
  if(search.matchMode==='all'&&terms.length>1)return `content:<${terms.map(term=>`"${everythingLiteral(term)}"`).join(' ')}> no-background-search:`;
  if(search.matchMode==='any'&&terms.length>1)return `content:<${terms.map(term=>`"${everythingLiteral(term)}"`).join('|')}> no-background-search:`;
  if(search.matchMode==='proximity'&&terms.length>1){
    const pattern=buildContentProximityRegex(terms,search.proximityWords);
    return `regex:content:"${everythingLiteral(pattern)}" no-background-search:`;
  }
  return `content:"${everythingLiteral(normalized)}" no-background-search:`;
}

export function contentMatchRanges(source,query,{matchMode='phrase',proximityWords=0,maxMatches=5000}={}){
  const needle=normalizeSearchText(query),search=normalizeContentSearchOptions({matchMode,proximityWords}),terms=contentTerms(needle);
  if(!source||needle.length<2)return {needle,search,ranges:[],capped:false};
  const haystack=source.toLocaleLowerCase('he-IL'),limit=Math.max(1,Math.min(20000,Number(maxMatches)||5000));
  let ranges=[],capped=false;
  const phonePattern=phoneSearchRegex(needle);
  if(phonePattern){
    const regex=new RegExp(phonePattern,'gu');let match;
    while((match=regex.exec(source))){ranges.push({index:match.index,length:match[0].length});if(ranges.length>=limit){capped=true;break}if(!match[0].length)regex.lastIndex+=1}
    return {needle,search,ranges,capped};
  }
  if(search.matchMode==='proximity'&&terms.length>1){
    const regex=new RegExp(buildContentProximityRegex(terms.map(term=>term.toLocaleLowerCase('he-IL')),search.proximityWords),'gu');
    let match;while((match=regex.exec(haystack))){ranges.push({index:match.index,length:match[0].length});if(ranges.length>=limit){capped=true;break}if(!match[0].length)regex.lastIndex+=1}
    return {needle,search,ranges,capped};
  }
  if(search.matchMode==='all'||search.matchMode==='any'){
    const unique=[...new Set(terms.map(term=>term.toLocaleLowerCase('he-IL')))];
    const termRanges=[];let missing=false;
    for(const term of unique){let found=0,offset=0;while(offset<=haystack.length-term.length){const index=haystack.indexOf(term,offset);if(index<0)break;termRanges.push({index,length:term.length});found+=1;offset=index+Math.max(1,term.length);if(termRanges.length>=limit){capped=true;break}}if(!found)missing=true;if(capped)break}
    if(search.matchMode==='all'&&missing)return {needle,search,ranges:[],capped:false};
    ranges=termRanges.sort((a,b)=>a.index-b.index||b.length-a.length).filter((row,index,list)=>index===0||row.index!==list[index-1].index||row.length!==list[index-1].length).slice(0,limit);
    return {needle,search,ranges,capped:capped||termRanges.length>limit};
  }
  const target=needle.toLocaleLowerCase('he-IL');let offset=0;
  while(offset<=haystack.length-target.length){const index=haystack.indexOf(target,offset);if(index<0)break;ranges.push({index,length:target.length});offset=index+Math.max(1,target.length);if(ranges.length>=limit){capped=true;break}}
  return {needle,search,ranges,capped};
}

export function contentSearchMatches(value,query,options={}){
  const source=String(value??''),needle=normalizeSearchText(query),search=normalizeContentSearchOptions(options),terms=contentTerms(needle);
  if(!source||needle.length<2)return false;
  const phonePattern=phoneSearchRegex(needle);if(phonePattern)return new RegExp(phonePattern,'u').test(source);
  const haystack=source.toLocaleLowerCase('he-IL');
  if(search.matchMode==='proximity'&&terms.length>1)return new RegExp(buildContentProximityRegex(terms.map(term=>term.toLocaleLowerCase('he-IL')),search.proximityWords),'u').test(haystack);
  if(search.matchMode==='all'||search.matchMode==='any'){const unique=[...new Set(terms.map(term=>term.toLocaleLowerCase('he-IL')))];return search.matchMode==='all'?unique.every(term=>haystack.includes(term)):unique.some(term=>haystack.includes(term))}
  return haystack.includes(needle.toLocaleLowerCase('he-IL'));
}

export function buildContentMatchInfo(value,query,{contextChars=90,maxSnippets=12,maxMatches=5000,matchMode='phrase',proximityWords=0}={}){
  const source=String(value??'').replace(/\u0000/g,''),needle=normalizeSearchText(query);
  if(!source||needle.length<2)return {query:needle,count:0,snippets:[],capped:false};
  const context=Math.max(24,Math.min(240,Number(contextChars)||90));
  const snippetLimit=Math.max(1,Math.min(30,Number(maxSnippets)||12));
  const matchLimit=Math.max(snippetLimit,Math.min(20000,Number(maxMatches)||5000)),found=contentMatchRanges(source,needle,{matchMode,proximityWords,maxMatches:matchLimit});
  const snippets=[];
  for(const row of found.ranges.slice(0,snippetLimit)){
      const index=row.index,length=row.length,start=Math.max(0,index-context),end=Math.min(source.length,index+length+context);
      const clean=part=>String(part??'').replace(/\s+/g,' ');
      snippets.push({before:clean(source.slice(start,index)).trimStart(),match:source.slice(index,index+length),after:clean(source.slice(index+length,end)).trimEnd(),leading:start>0,trailing:end<source.length});
  }
  return {query:needle,matchMode:found.search.matchMode,proximityWords:found.search.proximityWords,count:found.ranges.length,snippets,capped:found.capped};
}

export function buildEverythingQuery(value){
  // This mode intentionally mirrors the Everything search box. Operators,
  // filters and Everything syntax entered by the user are preserved.
  return normalizeSearchText(value);
}

export function normalizeSearchScopePath(value){
  const raw=String(value??'').trim();if(!raw)return '';
  const normalized=normalizeWindowsPath(raw);
  if(!normalized||!path.win32.isAbsolute(normalized))throw new TypeError('Search scope must be an absolute Windows path');
  return normalized;
}

export function buildNameQuery(value){return buildEverythingQuery(value)}

export function buildDocumentQuery(value,mode='everything',contentSearch={}){
  return normalizeDocumentSearchMode(mode)==='content'?buildContentQuery(value,contentSearch):buildEverythingQuery(value);
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
  // Search text itself is passed after -- (not with -search): ES parses/removes
  // quotes supplied to -search, which changes content:"multi word" semantics.
  return ['-argv','-cp','65001','-ipc3',...(instance?['-instance',String(instance)]:[]),'-timeout',String(timeout)];
}

const DOCUMENT_SORT_FIELDS=new Set(['name','path','size','modified']);
const DOCUMENT_SORT_DIRECTIONS=new Set(['asc','desc']);
const EVERYTHING_SORT_NAMES={name:'name',path:'path',size:'size',modified:'date-modified'};

export function normalizeDocumentSort(value={}){
  const field=DOCUMENT_SORT_FIELDS.has(String(value?.field||'').toLowerCase())?String(value.field).toLowerCase():'modified';
  const fallbackDirection=(field==='size'||field==='modified')?'desc':'asc';
  const direction=DOCUMENT_SORT_DIRECTIONS.has(String(value?.direction||'').toLowerCase())?String(value.direction).toLowerCase():fallbackDirection;
  return {field,direction};
}

export function compareDocumentRows(a,b,sort={}){
  const {field,direction}=normalizeDocumentSort(sort),factor=direction==='desc'?-1:1;
  let result=0;
  if(field==='size'){
    const left=Number(a?.size),right=Number(b?.size),l=Number.isFinite(left)?left:-1,r=Number.isFinite(right)?right:-1;result=l-r;
  }else if(field==='modified'){
    const left=Date.parse(a?.modified||''),right=Date.parse(b?.modified||''),l=Number.isFinite(left)?left:0,r=Number.isFinite(right)?right:0;result=l-r;
  }else{
    const left=field==='path'?String(a?.relativePath||a?.fullPath||''):String(a?.name||''),right=field==='path'?String(b?.relativePath||b?.fullPath||''):String(b?.name||'');
    result=left.localeCompare(right,'he',{numeric:true,sensitivity:'base'});
  }
  if(result)return result*factor;
  const pathResult=String(a?.fullPath||'').localeCompare(String(b?.fullPath||''),'he',{numeric:true,sensitivity:'base'});
  return pathResult*factor;
}

function everythingSortName(sort={}){const normalized=normalizeDocumentSort(sort);return `${EVERYTHING_SORT_NAMES[normalized.field]}-${normalized.direction==='desc'?'descending':'ascending'}`}

function displayArgs({limit=DEFAULT_RESULT_LIMIT,maxResults=MAX_RESULTS,offset=0,sort={}}){
  const ceiling=Math.max(1,Number(maxResults)||MAX_RESULTS);
  const count=Math.max(1,Math.min(ceiling,Number(limit)||DEFAULT_RESULT_LIMIT));
  const start=Math.max(0,Math.trunc(Number(offset)||0));
  return ['-json','-no-folder-append-path-separator','-date-format','3','-size-format','1','-no-digit-grouping','-name','-path-column','-size','-date-modified','-attributes','-sort',everythingSortName(sort),'-max-results',String(count),...(start?['-offset',String(start)]:[])];
}

export function buildEsRawSearchArgs({search,limit=DEFAULT_RESULT_LIMIT,timeoutMs=15000,instance='',filesOnly=false,maxResults=MAX_RESULTS,scopePath='',offset=0,sort={}}){
  if(!String(search??'').trim())throw new TypeError('Search expression is required');
  const scope=normalizeSearchScopePath(scopePath);
  return [...commonEsPrefix({timeoutMs,instance}),...displayArgs({limit,maxResults,offset,sort}),...(filesOnly?['/a-d']:[]),...(scope?['-path',scope]:[]),'--',String(search)];
}

export function buildEsSearchArgs({query,mode='everything',contentSearch={},limit=DEFAULT_RESULT_LIMIT,offset=0,timeoutMs=15000,instance='',scopePath='',sort={}}){
  const normalizedMode=normalizeDocumentSearchMode(mode),search=buildDocumentQuery(query,normalizedMode,contentSearch);
  if(!search)throw new TypeError('Search query must contain at least two characters');
  return buildEsRawSearchArgs({search,limit,offset,timeoutMs,instance,filesOnly:normalizedMode==='content',scopePath,sort});
}

export function buildEsRecentFilesArgs({limit=RECENT_RESULT_LIMIT,timeoutMs=15000,instance='',scopePath='' }={}){
  return buildEsRawSearchArgs({search:'*',limit,timeoutMs,instance,filesOnly:true,maxResults:RECENT_RESULT_LIMIT,scopePath,sort:{field:'modified',direction:'desc'}});
}

export function buildEsPdfInventoryArgs({limit=250,offset=0,timeoutMs=15000,instance='',scopePath='',modifiedSince=''}={}){
  const pageSize=Math.max(1,Math.min(1000,Math.trunc(Number(limit)||250)));
  const since=String(modifiedSince||'').trim();
  if(since&&!/^\d{4}-\d{2}-\d{2}$/.test(since))throw new Error('Invalid PDF inventory checkpoint date');
  return buildEsRawSearchArgs({search:`ext:pdf${since?` dm:>=${since}`:''}`,limit:pageSize,offset,timeoutMs,instance,filesOnly:true,maxResults:1000,scopePath});
}

export function documentExtension(fullPath){
  const name=path.win32.basename(String(fullPath||''));
  const extension=path.win32.extname(name).replace(/^\./,'').toLowerCase();
  return extension||(/^\.[^.]+$/.test(name)?name.slice(1).toLowerCase():'');
}

export function buildExactFullPathQuery(fullPath){
  const normalized=normalizeWindowsPath(fullPath);
  if(!normalized)throw new TypeError('Full path is required');
  return `whole:fullpath:"${everythingLiteral(normalized)}"`;
}

export function buildEsContentPreviewArgs({fullPath,timeoutMs=15000,instance=''}){
  const search=buildExactFullPathQuery(fullPath);
  return [...commonEsPrefix({timeoutMs,instance}),'-json','-no-folder-append-path-separator','-name','-path-column','-add-columns','content','-max-results','1','--',search];
}

export function buildEsCountArgs({search='*',timeoutMs=15000,instance='',filesOnly=true}){
  if(!text(search))throw new TypeError('Search expression is required');
  return [...commonEsPrefix({timeoutMs,instance}),'-no-digit-grouping',...(filesOnly?['/a-d']:[]),'-get-result-count','--',String(search)];
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
    const extension=documentExtension(name);
    const attributes=text(field(row,['attributes','attribs','attrib']));
    const isDirectory=attributes.toUpperCase().includes('D')||/directory/i.test(attributes);
    return {name,fullPath,relativePath:parent,modified,size:Number.isFinite(size)?size:null,extension,attributes,isDirectory,rootId:'everything',rootLabel:'Everything'};
  }).filter(Boolean);
}

export function parseEsContentPreview(stdout){
  const raw=String(stdout??'').replace(/^\uFEFF/,'').trim();
  if(!raw)return '';
  let parsed;
  try{parsed=JSON.parse(raw)}catch(error){const e=new Error('ES returned invalid preview JSON');e.code='ES_INVALID_PREVIEW_JSON';e.cause=error;throw e}
  const row=jsonRows(parsed)[0];
  return text(field(row,['content']));
}

export function mergeDocumentResults(groups,limit=DEFAULT_RESULT_LIMIT,maxResults=MAX_RESULTS){
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
  const ceiling=Math.max(1,Number(maxResults)||MAX_RESULTS);
  return rows.slice(0,Math.max(1,Math.min(ceiling,Number(limit)||DEFAULT_RESULT_LIMIT)));
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
