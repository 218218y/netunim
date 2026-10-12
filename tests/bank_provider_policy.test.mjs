// Frozen AST fixtures captured before configuration ownership changed. Position,
// formatting and the former shared busy flag are excluded; provider algorithms
// (retry/fallback, identity recovery, error envelopes and browser cleanup) are exact.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parse} from 'acorn';
import {createHash} from 'node:crypto';
const names=["normalizeCreditSyncSelection","excludedAccountsForProfile","scrapeCreditProfile","scrapeAllCreditProfiles","scrapeHapoalimSnapshot"];
function policies(source){
  const ast=parse(source,{ecmaVersion:'latest',sourceType:'module'}),out={};
  for(const name of names){
    const node=structuredClone(ast.body.find(node=>node.type==='FunctionDeclaration'&&node.id.name===name));
    if(!node)throw new Error(`missing provider function: ${name}`);
    node.body.body=node.body.body.filter(statement=>!(statement.type==='IfStatement'&&statement.test.type==='Identifier'&&statement.test.name==='scrapeBusy')&&!(statement.type==='ExpressionStatement'&&statement.expression.type==='AssignmentExpression'&&statement.expression.left.name==='scrapeBusy'));
    if(name==='scrapeAllCreditProfiles'&&node.body.body[0].type==='TryStatement')node.body.body=node.body.body[0].block.body;
    if(name==='scrapeHapoalimSnapshot'){
      const statement=node.body.body.find(row=>row.type==='TryStatement');
      statement.finalizer.body=statement.finalizer.body.filter(row=>!(row.type==='ExpressionStatement'&&row.expression.type==='AssignmentExpression'&&row.expression.left.name==='scrapeBusy'));
    }
    const stable=JSON.stringify(node,(key,value)=>['start','end','raw'].includes(key)?undefined:value);
    out[name]=createHash('sha256').update(stable).digest('hex');
  }
  return out;
}
test('Bank and credit provider policies match their reviewed pre-refactor AST fixtures',()=>{
  const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/bank-provider-policy.json',import.meta.url),'utf8'));
  const source=fs.readFileSync(new URL('../netunim-kupa/bank-bridge/server.mjs',import.meta.url),'utf8');
  assert.deepEqual(policies(source),fixture.policies);
});
