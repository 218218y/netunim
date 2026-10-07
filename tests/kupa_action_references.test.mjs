import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'..');
const site=path.join(root,'netunim-kupa/site');
const packs=path.join(site,'assets/js/ui/action-packs');
const actionSources=[...fs.readdirSync(packs).map(name=>path.join(packs,name)),
  ...['notes-workbook.js','spreadsheet-workspace.js','credit-card-order-view.js'].map(name=>path.join(root,'shared',name))];
const registered=new Set(actionSources.flatMap(file=>[...fs.readFileSync(file,'utf8').matchAll(/^\s*'([a-z][a-z0-9-]+)'\s*:/gm)].map(match=>match[1])));

function sourceFiles(directory){
  return fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{
    const file=path.join(directory,entry.name);
    if(entry.isDirectory())return sourceFiles(file);
    return /\.(?:js|html)$/.test(entry.name)?[file]:[];
  });
}

test('literal delegated actions rendered by Kupa have a registered owner',()=>{
  const referenced=new Set();
  for(const file of sourceFiles(site)){
    if(file.includes(`${path.sep}vendor${path.sep}`))continue;
    const source=fs.readFileSync(file,'utf8');
    for(const match of source.matchAll(/\bdata-(?:action|change|input|keydown|focus|blur|dragstart|dragover|drop|dragend)=["']([a-z][a-z0-9-]*)["']/g))referenced.add(match[1]);
  }
  assert.deepEqual([...referenced].filter(name=>!registered.has(name)).sort(),[]);
  const renderSources=sourceFiles(site).filter(file=>!file.includes(`${path.sep}action-packs${path.sep}`)&&!file.endsWith(`${path.sep}ui${path.sep}actions.js`)&&!file.endsWith(`${path.sep}ui${path.sep}secondary-read-only-actions.js`)).map(file=>fs.readFileSync(file,'utf8'));
  const dynamicDateAction=fs.readFileSync(path.join(root,'shared/cashflow-breakdown.js'),'utf8').includes('change:`${action}-date`')&&renderSources.some(source=>source.includes("'cashflow-breakdown',role,dateEditorMarkup"));
  assert.ok(dynamicDateAction,'cashflow date action is derived from the registered breakdown action');
  const unused=[...registered].filter(name=>name!=='cashflow-breakdown-date'&&!referenced.has(name)&&!renderSources.some(source=>source.includes(`'${name}'`)||source.includes(`"${name}"`)));
  assert.deepEqual(unused.sort(),[]);
});

test('Kupa action packs keep bounded collaborators',()=>{
  for(const file of fs.readdirSync(packs)){
    const source=fs.readFileSync(path.join(packs,file),'utf8');
    const signature=source.match(/export function create\w+Actions\(\{([^}]*)\}\)/)?.[1];
    assert.ok(signature,`${file}: capability factory is explicit`);
    assert.ok(signature.split(',').filter(Boolean).length<=8,`${file}: too many action collaborators`);
  }
  const main=fs.readFileSync(path.join(site,'assets/js/main.js'),'utf8');
  assert.ok(!main.includes('createUiActions('),'Kupa must not rebuild the action mega-factory');
});
