import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parse} from 'acorn';
import {createDocumentPreviewModules} from '../shared/document-search/domains/documents/preview-modules.js';

function gate(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}}
function host(){
  const element={children:[],ownerDocument:{createElement:()=>host()},replaceChildren(...children){for(const old of this.children)old.parent=null;this.children=children;for(const child of children)child.parent=this},remove(){if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);this.parent=null}};
  return element;
}
const methods={pdf:'createPdfSearchViewer',docx:'createDocxSearchViewer',text:'createTextSearchViewer',spreadsheet:'createSpreadsheetSearchViewer'};
for(const [kind,method] of Object.entries(methods)){
  test(`${kind}: construction is lazy, concurrent use shares a loader and requires current selection`,async()=>{
    const loaded=gate(),mounts=[];let imports=0,active=true,destroyed=0;
    const owner=createDocumentPreviewModules({load:{[kind]:()=>{imports++;return loaded.promise}}});
    assert.equal(imports,0);await assert.rejects(owner[method]({host:host()}),/current_scope_required/);
    assert.equal(await owner[method]({host:host()},()=>false),null);assert.equal(imports,0);
    const a=owner[method]({host:host()},()=>active),b=owner[method]({host:host()},()=>true);
    await Promise.resolve();assert.equal(imports,1);active=false;
    loaded.resolve({[method]:async options=>{mounts.push(options.host);return {destroy:async()=>{destroyed++},matchState:()=>({total:1})}}});
    assert.equal(await a,null);const viewer=await b;assert.equal(mounts.length,1);
    assert.equal(viewer.matchState().total,1);await viewer.destroy();await viewer.destroy();assert.equal(destroyed,1);
  });
  test(`${kind}: a stale completed viewer cannot erase a replacement preview`,async()=>{
    const creating=gate(),entered=gate(),root=host();let active=true,oldMount,destroyed=0;
    const owner=createDocumentPreviewModules({load:{[kind]:async()=>({[method]:async options=>{
      oldMount=options.host;entered.resolve();await creating.promise;
      return {destroy:async()=>{destroyed++;oldMount.replaceChildren()}};
    }})}});
    const task=owner[method]({host:root},()=>active);await entered.promise;
    active=false;const replacement=host();root.replaceChildren(replacement);creating.resolve();
    assert.equal(await task,null);assert.equal(destroyed,1);assert.deepEqual(root.children,[replacement]);
  });
  test(`${kind}: failed loads can be retried and late factory errors keep replacement DOM`,async()=>{
    let attempt=0,active=true;const creating=gate(),entered=gate(),root=host();
    const owner=createDocumentPreviewModules({load:{[kind]:async()=>{
      if(++attempt===1)throw new Error('module-load-failed');
      return {[method]:async()=>{entered.resolve();return creating.promise}};
    }}});
    await assert.rejects(owner[method]({host:root},()=>active),/module-load-failed/);
    const task=owner[method]({host:root},()=>active);await entered.promise;
    active=false;const replacement=host();root.replaceChildren(replacement);creating.reject(new Error('factory-failed'));
    await assert.rejects(task,/factory-failed/);assert.deepEqual(root.children,[replacement]);assert.equal(attempt,2);
  });
}

test('preload shares the module loader without constructing viewers',async()=>{
  let imports=0,preloads=0,constructors=0;
  const owner=createDocumentPreviewModules({load:{pdf:async()=>{imports++;return {
    preloadPdfSearchRuntime:async()=>{preloads++;return 'runtime'},createPdfSearchViewer:()=>{constructors++},
  }}}});
  assert.deepEqual(await Promise.all([owner.preloadPdfSearchRuntime(),owner.preloadPdfSearchRuntime()]),['runtime','runtime']);
  assert.equal(imports,1);assert.equal(preloads,2);assert.equal(constructors,0);
});

test('every shell viewer construction carries the captured selection proof',()=>{
  const ast=parse(fs.readFileSync('shared/global-document-search.js','utf8'),{ecmaVersion:'latest',sourceType:'module'});let count=0;
  function walk(node){
    if(!node?.type)return;
    if(node.type==='CallExpression'&&Object.values(methods).includes(node.callee.name)){
      count++;assert.equal(node.arguments.length,2);assert.equal(node.arguments[1].name,'current');
    }
    for(const value of Object.values(node))for(const child of Array.isArray(value)?value:[value])if(child?.type)walk(child);
  }
  walk(ast);assert.equal(count,5);
});

for(const newline of ['\n','\r\n'])test(`implementation mutations preserve scope and private mounts (${JSON.stringify(newline)})`,async()=>{
  const source=fs.readFileSync('shared/document-search/domains/documents/preview-modules.js','utf8').replace(/\r\n?/g,'\n').replace(/\n/g,newline);
  const mutate=async(from,to)=>{
    from=from.replace(/\n/g,newline);
    assert.equal(source.split(from).length,2,'mutation must replace exactly one production expression');
    const module=await import('data:text/javascript;base64,'+Buffer.from(source.replace(from,to)).toString('base64'));
    return module.createDocumentPreviewModules;
  };
  const missingGuard=await mutate('const implementation=await module(kind);\n    if(!isCurrent())return null;','const implementation=await module(kind);');
  let active=true,constructed=0;const load=gate();
  const unsafe=missingGuard({load:{text:()=>load.promise}});
  const task=unsafe.createTextSearchViewer({host:host()},()=>active);active=false;
  load.resolve({createTextSearchViewer:async()=>{constructed++;return {destroy:async()=>{}}}});
  await task;assert.equal(constructed,1,'negative implementation must expose the skipped guard');
  const sharedHost=await mutate('({...options,host:mount})','({...options,host})');
  const root=host(),creating=gate(),entered=gate();active=true;
  const corrupt=sharedHost({load:{text:async()=>({createTextSearchViewer:async options=>{
    entered.resolve();await creating.promise;return {destroy:async()=>options.host.replaceChildren()};
  }})}});
  const late=corrupt.createTextSearchViewer({host:root},()=>active);await entered.promise;
  const replacement=host();root.replaceChildren(replacement);active=false;creating.resolve();await late;
  assert.equal(root.children.length,0,'negative implementation must erase the replacement, unlike the real owner');
});
