import fs from 'node:fs/promises';
import path from 'node:path';

const forbidden=()=>Object.assign(new Error('הקובץ מחוץ לתיקיות העסק המורשות. יש לבחור תיקיות בהגדרות המחבר במחשב.'),{code:'DOCUMENT_PATH_FORBIDDEN'});
function inside(root,target){const relative=path.relative(root,target);return relative===''||relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative)}

// Configuration is local-only. Check both the indexed path and its current
// filesystem target; an opaque result ID never freezes permission indefinitely.
export function createDocumentFileAccess({loadConfig,files=fs}){
  const rootTargets=new Map();
  async function roots(){
    const config=await loadConfig(),input=config.roots;
    if(!Array.isArray(input)||!input.length)throw Object.assign(new Error('יש להגדיר תיקיות עסק מורשות בהגדרות Document Bridge במחשב.'),{code:'DOCUMENT_ROOTS_NOT_CONFIGURED'});
    const result=[];
    for(const item of input){
      const value=typeof item==='string'?item:item?.path;
      if(typeof value!=='string'||!path.isAbsolute(value)||value.includes('\0')||value.includes('"')||value.startsWith('\\\\?\\')||value.startsWith('\\\\.\\'))throw forbidden();
      const lexical=path.resolve(value);
      if(lexical===path.parse(lexical).root)throw forbidden();
      const canonical=await files.realpath(lexical);
      if(rootTargets.has(lexical)&&rootTargets.get(lexical)!==canonical)throw forbidden();
      rootTargets.set(lexical,canonical);
      if(!(await files.stat(canonical)).isDirectory())throw forbidden();
      result.push({lexical,canonical});
    }
    return result;
  }
  async function check(target,allowed){
    if(typeof target!=='string'||!path.isAbsolute(target)||target.includes('\0')||target.startsWith('\\\\?\\')||target.startsWith('\\\\.\\')||process.platform==='win32'&&target.slice(2).includes(':'))throw forbidden();
    const lexical=path.resolve(target),candidates=allowed.filter(root=>inside(root.lexical,lexical));
    if(!candidates.length)throw forbidden();
    const canonical=await files.realpath(lexical);
    if(!candidates.some(root=>inside(root.canonical,canonical)))throw forbidden();
    return canonical;
  }
  return Object.freeze({
    assertConfigured:async()=>{await roots()},
    async scopeArguments(args){
      const allowed=await roots(),index=args.indexOf('--');
      if(index<0||index!==args.length-2)throw forbidden();
      const paths=[...new Set(allowed.flatMap(root=>[root.lexical,root.canonical]))];
      const escape=value=>value.replace(/[\\^$.*+?()[\]{}|]/g,'\\$&');
      // Everything's regex:path modifier constrains ordinary searches and PDF
      // inventory before pagination. Filesystem authorization remains decisive,
      // including for adversarial Everything expressions or reparse points.
      const expression=`regex:path:"^(?:${paths.map(escape).join('|')})(?:\\\\|$)"`;
      return [...args.slice(0,index+1),`${expression} <${args[index+1]}>`];
    },
    authorize:async target=>check(target,await roots()),
    async admit(rows){
      const allowed=await roots(),result=[];
      for(const row of rows){
        try{result.push({...row,fullPath:await check(row.fullPath,allowed)})}
        catch(error){if(!['DOCUMENT_PATH_FORBIDDEN','ENOENT','EACCES','EPERM'].includes(error?.code))throw error}
      }
      return result;
    }
  });
}
