import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {tokenizer} from 'acorn';

const repository=fileURLToPath(new URL('../',import.meta.url));
const baselinePath=path.join(repository,'tests/fixtures/readability-baseline.json');

export function measureReadability(source){
  const lengths=source.replaceAll('\r\n','\n').split('\n').map(line=>line.length);
  return {over500:lengths.filter(length=>length>500).length,over1000:lengths.filter(length=>length>1000).length,longest:Math.max(0,...lengths)};
}

function* canonicalSources(root){
  function* visit(directory){
    for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
      const absolute=path.join(directory,entry.name),relative=path.relative(root,absolute).split(path.sep).join('/');
      // Canonical shared code is counted once, including Document Search sources.
      if(entry.isDirectory()){
        if(/^netunim-(kupa|orders)\/site\/assets\/js\/shared$/.test(relative))continue;
        yield* visit(absolute);
      }else if(/\.m?js$/.test(entry.name)){
        const publicRelative=relative.match(/^netunim-(?:kupa|orders)\/site\/assets\/js\/(.+)$/)?.[1];
        if(publicRelative&&fs.existsSync(path.join(root,'shared/document-search',publicRelative)))continue;
        yield {file:relative,source:fs.readFileSync(absolute,'utf8')};
      }
    }
  }
  for(const name of ['shared','netunim-kupa/site/assets/js','netunim-orders/site/assets/js'])yield* visit(path.join(root,name));
}

export function auditReadability(root=repository){
  const files=Object.fromEntries([...canonicalSources(root)].map(({file,source})=>[file,measureReadability(source)]));
  return Object.fromEntries(Object.entries(files).sort(([a],[b])=>a.localeCompare(b)));
}

// Read cooked string/template tokens so escaped corruption is also visible.
// Operators, comments, regexes, URLs and isolated question placeholders are
// deliberately outside the repeated-unreadable-word rule.
export function textIntegrityViolations(source){
  const failures=[];
  for(const token of tokenizer(source,{ecmaVersion:'latest',sourceType:'module',locations:true})){
    if(!['string','template'].includes(token.type.label))continue;
    const value=token.value;
    const reason=value.includes('\uFFFD')?'unicode replacement character'
      :/\?{2,}(?:[\s.,:;!…-]+\?{2,})+/u.test(value)?'unreadable question-mark words':null;
    if(reason)failures.push({line:token.loc.start.line,column:token.loc.start.column+1,reason});
  }
  return failures;
}

export function auditTextIntegrity(root=repository){
  return [...canonicalSources(root)].flatMap(({file,source})=>textIntegrityViolations(source).map(failure=>({file,...failure})));
}

export function readabilityRegressions(current,baseline){
  const failures=[];
  for(const [file,stats] of Object.entries(current)){
    const previous=baseline[file]??{over500:0,over1000:0,longest:500};
    for(const key of ['over500','over1000'])if(stats[key]>previous[key])failures.push(`${file}: ${key} ${stats[key]} exceeds ${previous[key]}`);
    if(stats.longest>Math.max(500,previous.longest))failures.push(`${file}: longest ${stats.longest} exceeds ${Math.max(500,previous.longest)}`);
  }
  return failures;
}

export function readabilityTotals(files){
  return Object.values(files).reduce((sum,row)=>({over500:sum.over500+row.over500,over1000:sum.over1000+row.over1000,longest:Math.max(sum.longest,row.longest)}),{over500:0,over1000:0,longest:0});
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const files=auditReadability(),totals=readabilityTotals(files);
  if(process.argv.includes('--write-baseline')){
    const limited=Object.fromEntries(Object.entries(files).filter(([,row])=>row.over500));
    fs.writeFileSync(baselinePath,JSON.stringify({version:1,files:limited},null,2)+'\n');
    console.log('Wrote intentional readability baseline:',JSON.stringify(totals));
  }else{
    const baseline=JSON.parse(fs.readFileSync(baselinePath,'utf8'));
    const failures=[...readabilityRegressions(files,baseline.files),
      ...auditTextIntegrity().map(({file,line,column,reason})=>`${file}:${line}:${column}: ${reason}`)];
    for(const failure of failures)console.error(failure);
    console.log('Canonical application readability:',JSON.stringify(totals));
    if(failures.length)process.exitCode=1;
  }
}
