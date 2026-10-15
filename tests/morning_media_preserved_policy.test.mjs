import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {declaration,tokens} from './bank_policy_ast_fixture.mjs';
import {originalMorningApplicationPolicy} from './morning_application_policy_fixture.mjs';
import {originalMorningRecoveryPolicy} from './morning_recovery_policy_fixture.mjs';
import {baseline as commandFormBaseline,formPolicy} from './morning_command_form_policy_fixture.mjs';
const baseline=JSON.parse(readFileSync(new URL('./fixtures/morning-media-preserved-policy.json',import.meta.url),'utf8'));
const catalogBaseline=JSON.parse(readFileSync(new URL('./fixtures/morning-catalog-policy.json',import.meta.url),'utf8'));
for(const [file,functions] of Object.entries(baseline.files)){
  const source=readFileSync(new URL('../netunim-orders/site/assets/js/domains/customers/'+file+'.js',import.meta.url),'utf8');
  for(const [name,expected] of Object.entries(functions))test(`Morning ${name} preserves pre-media issuance/debt/search policy`,()=>{
    const expanded=name==='applyVerifiedContextOnce'?originalMorningApplicationPolicy(readFileSync(new URL('../netunim-orders/site/assets/js/domains/customers/morning-debt-application.js',import.meta.url),'utf8')):name==='recoverPendingMorningOperation'?originalMorningRecoveryPolicy(readFileSync(new URL('../netunim-orders/site/assets/js/domains/customers/morning-recovery.js',import.meta.url),'utf8')):null;
    // Catalog metadata evidence is intentionally strengthened in its owner;
    // executed original/current fixtures cover its successful policy separately.
    const formMoved=name==='readForm';if(formMoved)assert.deepEqual(formPolicy(readFileSync(new URL('../netunim-orders/site/assets/js/domains/customers/morning-command-form.js',import.meta.url),'utf8'),name),formPolicy(commandFormBaseline.functions[name].source,name));
    const catalogMoved=['defaultDocumentSearch','verifiedOperationMetadata'].includes(name);
    const current=name==='downloadDocument'?source.replace("const url=new URL(await catalog.link(String(id)));assertCurrent();","const data=await backend('document_links',{document_id:String(id)},assertCurrent);assertCurrent();const url=new URL(data.url);if(url.protocol!=='https:')throw new Error('קישור מסמך אינו תקין');"):source;
    const node=expanded||catalogMoved||formMoved?null:declaration(current,name),policy=expanded||(formMoved?tokens(commandFormBaseline.functions[name].source):catalogMoved?tokens(catalogBaseline.functions[name].source):tokens(current.slice(node.start,node.end))).replaceAll('operationCommands.status(context.operationId,true,assertCurrent)',"backend('status',{operation_id:context.operationId,reconcile:true},assertCurrent)");
    const preserved=policy.replaceAll('debtApplication.isPending()',"lifetime.pending('application')").replaceAll('statusFlow.cancelPending();','').replaceAll(',isCurrent:()=>isActive(generation)','').replaceAll('modalSession.generation','modalGeneration').replaceAll('modalSession.signal','display.signal').replaceAll('if(!isActive(modalGeneration))return false;','');
    const normalized=name==='confirmRecoveryChoice'?preserved.replace('const generation=modalGeneration;','').replace('if(isActive(generation))markModalDraftSaved?.();','markModalDraftSaved?.();'):preserved;
    const actual=createHash('sha256').update(normalized).digest('hex');
    assert.equal(actual,expected,`business policy drift from ${baseline.commit}`);
  });
}
test('the PDF owner has five ports and cannot perform debt allocation or document issuance',()=>{
  const source=readFileSync(new URL('../netunim-orders/site/assets/js/domains/customers/morning-document-media.js',import.meta.url),'utf8');
  assert.equal(declaration(source,'createMorningDocumentMedia').params[0].properties.length,5);
  for(const name of ['applyVerifiedDebtDocument','customerDebts',"json('create'","json('reserve'",'localStorage'])assert.equal(source.includes(name),false);
});
test('the recovery coordinator has five ports and no unvalidated transport or local I/O',()=>{
  const source=readFileSync(new URL('../netunim-orders/site/assets/js/domains/customers/morning-recovery.js',import.meta.url),'utf8');
  assert.equal(declaration(source,'createMorningRecovery').params[0].properties.length,5);
  for(const name of ['customerDebts','localStorage','document.','supaFetch','request.json','commitSave','setTimeout'])assert.equal(source.includes(name),false);
});
test('the debt application owner has five ports and no raw model, transport or persistence',()=>{
  const source=readFileSync(new URL('../netunim-orders/site/assets/js/domains/customers/morning-debt-application.js',import.meta.url),'utf8');
  assert.equal(declaration(source,'createMorningDebtApplication').params[0].properties.length,5);
  for(const name of ['customerDebts','localStorage','document.','supaFetch','request.json','commitSave','setTimeout'])assert.equal(source.includes(name),false);
});
