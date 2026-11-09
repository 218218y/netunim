import fs from 'node:fs/promises';
import path from 'node:path';

const forbidden=()=>Object.assign(new Error('הנתיב מחוץ להיקף החיפוש המורשה או מוגן בהגדרות המחבר.'),{code:'DOCUMENT_PATH_FORBIDDEN'});
function inside(root,target){const relative=path.relative(root,target);return relative===''||relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative)}
const unavailable=new Set(['ENOENT','ENOTDIR','EACCES','EPERM']);
const systemFolders=['Windows','Program Files','Program Files (x86)','ProgramData','WindowsApps','WpSystem','System Volume Information','$Recycle.Bin','Recovery','PerfLogs'];
const privateFolders=['NetunimDocumentBridge','NetunimKupaBankBridge','NetunimSecurity'];
const ancestor=value=>'ancestor:"'+value.replace(/\\$/,'')+'"';

// Configuration is local-only. Check both the indexed path and its current
// filesystem target; an opaque result ID never freezes permission indefinitely.
export function createDocumentFileAccess({loadConfig,files=fs,protectedPaths=[],visible=async paths=>paths.map(()=>true)}){
  const rootTargets=new Map();
  const exclusions=protectedPaths.filter(value=>typeof value==='string'&&path.isAbsolute(value)).map(value=>path.resolve(value));
  const protectedPath=target=>{
    const root=path.parse(target).root,segments=target.slice(root.length).split(path.sep);
    return exclusions.some(value=>inside(value,target))
      ||systemFolders.some(name=>name.toLowerCase()===segments[0].toLowerCase())
      ||segments.some(part=>part.startsWith('.')||privateFolders.some(name=>name.toLowerCase()===part.toLowerCase()));
  };
  function absolute(value){
    return typeof value==='string'&&path.isAbsolute(value)&&!/[\0\r\n"]/.test(value)
      &&!value.startsWith('\\\\?\\')&&!value.startsWith('\\\\.\\')
      &&(process.platform!=='win32'||/^(?:[a-z]:[\\/]|\\\\[^?.\\][^\\]*\\[^\\]+)/i.test(value)&&!value.slice(2).includes(':'));
  }
  async function roots(){
    const config=await loadConfig(),input=config.roots;
    const missing=()=>Object.assign(new Error('יש לבחור לפחות תיקייה או כונן זמינים בהגדרות Document Bridge במחשב.'),{code:'DOCUMENT_ROOTS_NOT_CONFIGURED'});
    if(!Array.isArray(input)||!input.length)throw missing();
    const result=[];
    for(const item of input){
      const value=typeof item==='string'?item:item?.path;
      if(!absolute(value))throw forbidden();
      const lexical=path.resolve(value);
      if(lexical===path.parse(lexical).root&&!(config.allowDriveRoots===true&&/^[a-z]:\\$/i.test(lexical)))throw forbidden();
      let canonical;
      try{
        canonical=await files.realpath(lexical);
        if(!(await files.stat(canonical)).isDirectory())throw forbidden();
      }catch(error){
        if(unavailable.has(error?.code))continue;
        throw error;
      }
      if(protectedPath(lexical)||protectedPath(canonical))throw forbidden();
      if(rootTargets.has(lexical)&&rootTargets.get(lexical)!==canonical)throw forbidden();
      rootTargets.set(lexical,canonical);
      result.push({lexical,canonical});
    }
    if(!result.length)throw missing();
    return result;
  }
  async function check(target,allowed){
    if(!absolute(target))throw forbidden();
    const lexical=path.resolve(target),candidates=allowed.filter(root=>inside(root.lexical,lexical));
    if(!candidates.length||protectedPath(lexical))throw forbidden();
    const canonical=await files.realpath(lexical);
    if(protectedPath(canonical)||!candidates.some(root=>inside(root.canonical,canonical)))throw forbidden();
    return {lexical,canonical};
  }
  async function visibility(matches){
    const paths=[...new Set(matches.flatMap(({lexical,canonical})=>[lexical,canonical]))];
    if(!paths.length)return [];
    const result=await visible(paths);
    if(result.length!==paths.length)throw forbidden();
    const permitted=new Set(paths.filter((_,index)=>result[index]===true));
    return matches.map(({lexical,canonical})=>permitted.has(lexical)&&permitted.has(canonical));
  }
  return Object.freeze({
    assertConfigured:async()=>{await roots()},
    async scopeArguments(args){
      const allowed=await roots(),index=args.indexOf('--');
      if(index<0||index!==args.length-2)throw forbidden();
      const paths=[...new Set(allowed.flatMap(root=>[root.lexical,root.canonical]))];
      // Use Everything's exact ancestor function, including C: for a whole
      // volume. Quoted regex paths lost backslashes in the pinned ES parser.
      const volumes=[...new Set(paths.map(value=>path.parse(value).root))];
      const protectedAncestors=[...exclusions,...volumes.flatMap(volume=>systemFolders.map(name=>path.join(volume,name)))];
      const expression=[
        '<'+paths.map(ancestor).join('|')+'>',
        ...protectedAncestors.map(value=>'!'+ancestor(value)),
        ...privateFolders.map(name=>'!whole:ancestor-name:'+name),
        '!attributes:H','!attributes:S',
      ].join(' ');
      return [...args.slice(0,index+1),expression+' <'+args[index+1]+'>'];
    },
    async authorize(target){
      const match=await check(target,await roots());
      if(!(await visibility([match]))[0])throw forbidden();
      return match.canonical;
    },
    async admit(rows){
      const allowed=await roots(),matches=[],accepted=[];
      for(const row of rows){
        try{matches.push(await check(row.fullPath,allowed));accepted.push(row)}
        catch(error){if(error?.code!=='DOCUMENT_PATH_FORBIDDEN'&&!unavailable.has(error?.code))throw error}
      }
      const permitted=await visibility(matches);
      return accepted.flatMap((row,index)=>permitted[index]?[{...row,fullPath:matches[index].canonical}]:[]);
    }
  });
}
