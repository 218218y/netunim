import {readFileSync} from 'node:fs';
import {declaration} from './bank_policy_ast_fixture.mjs';
export const baseline=JSON.parse(readFileSync(new URL('./fixtures/morning-command-form-policy.json',import.meta.url),'utf8'));
function clean(value){if(Array.isArray(value))return value.map(clean);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!['start','end','raw','loc'].includes(key)).map(([key,v])=>[key,clean(v)]));return value}
export function formPolicy(source,name){
 const node=declaration(source,name);let value=source.slice(node.start,node.end);
 if(name==='readForm')value=value.replace(/const\s*\{operationId:activeOperationId,debtId:activeDebtId,source:activeSource\}\s*=\s*session.context\(\);/,'').replace(/const\s*\{\s*operationId:\s*activeOperationId,\s*debtId:\s*activeDebtId,\s*source:\s*activeSource\s*\}\s*=\s*session.context\(\);/,'');
 if(name==='debtImpactConfirmation'&&node.params.length===5)value=value.replace('function debtImpactConfirmation(activeDebtId, debt, type, amount, policy)','function debtImpactConfirmation(type,amount,policy=debtUpdatePolicy(type))').replace('function debtImpactConfirmation(activeDebtId,debt,type,amount,policy)','function debtImpactConfirmation(type,amount,policy=debtUpdatePolicy(type))').replace("if(!debt)return",'const debt=currentDebt();if(!debt)return').replace('if (!debt)\n','const debt=currentDebt();if (!debt)\n');
 return clean(declaration(value,name));
}
