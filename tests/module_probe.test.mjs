import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';

const probe=resolve('tests/module_probe.cjs');
function run(input){return JSON.parse(execFileSync(process.execPath,[probe],{input:JSON.stringify(input),encoding:'utf8'}))}

test('public APIs are discovered by structure, with aliases, destructuring, composition and receivers',async()=>{
  const site=mkdtempSync(join(tmpdir(),'netunim-public-probe-'));
  try{
    mkdirSync(join(site,'assets/js'),{recursive:true});
    writeFileSync(join(site,'package.json'),' {"type":"module"}');
    const original=`
export function assemble(seed) {
  let count=seed;
  function hiddenImplementation(){return -1}
  function increment(){return ++count}
  function invoke(){return increment()}
  const result={advance:increment,invoke,child:{factor:3,multiply(n){return this.factor*n}}};
  return result;
}
export const buildArrow=()=>({spark:()=>42});
export function branch(flag){if(flag)return{yesBranch:()=>true};return{noBranch:()=>false}}
export function combine(){const leaf=assemble(10);return{leaf,...buildArrow(),launch:(n)=>leaf.child.multiply(n)}}
export const instance=assemble(0);
export const {spark:renamed}=buildArrow();
export const composition=combine();
export const branches=[branch(true),branch(false)];
export const direct={setTimeout:()=>123,child:{weight:2,weigh(n){return this.weight*n}}};
`;
    writeFileSync(join(site,'assets/js/factory.js'),original);
    writeFileSync(join(site,'assets/js/default.js'),'export default ()=>({orbit(){return 7}});');
    writeFileSync(join(site,'assets/js/main.js'),"import boot from './default.js'; export const selected=boot();");
    const inventory=run({mode:'instrument',site});
    for(const name of ['advance','invoke','multiply','spark','renamed','launch','yesBranch','noBranch','orbit','weigh'])assert.ok(inventory.includes(name),name);
    assert.ok(!inventory.includes('hiddenImplementation'),'private implementation is not a probe contract');
    const {bindings}=await import(pathToFileURL(join(site,'test-access.js')));
    assert.equal(bindings.advance(),11);
    assert.equal(bindings.multiply(4),12,'receiver is preserved');
    assert.equal(bindings.launch(5),15);
    assert.equal(bindings.renamed(),42);
    assert.equal(bindings.spark(),42);
    assert.equal(bindings.orbit(),7);
    assert.equal(bindings.weigh(6),12);
    assert.equal(bindings.setTimeout,globalThis.setTimeout,'host globals are not shadowed by public method names');
    assert.equal(bindings.direct.setTimeout(),123,'colliding methods remain accessible on their API');
    assert.equal(bindings.yesBranch(),true);
    assert.equal(bindings.noBranch(),false);
    assert.deepEqual(Object.keys(bindings.composition.leaf),['advance','invoke','child'],'no synthetic facade is added to the API');
    bindings.advance=()=>90;
    assert.equal(bindings.invoke(),90,'public stubs reach the factory lexical method');
    assert.equal(bindings.composition.leaf.advance(),90);
    assert.equal(bindings.hiddenImplementation,undefined);
    const expression=run({mode:'expression',names:inventory,expression:'(()=>{const spark=()=>1;return {spark:spark(),advance:advance()}})()'});
    assert.ok(expression.includes('advance:__netunimProbe.advance()'));
    assert.ok(expression.includes('spark:spark()'),'local bindings are never rewritten');
    assert.ok(!original.includes('__testBindings'));
    assert.ok(readFileSync(join(site,'assets/js/factory.js'),'utf8').includes('test-probe-runtime.js'));
  }finally{rmSync(site,{recursive:true,force:true})}
});
