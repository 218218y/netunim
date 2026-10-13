import assert from 'node:assert/strict';
import {parse} from 'acorn';
import {createHash} from 'node:crypto';

const expression=source=>parse('const value='+source,{ecmaVersion:'latest',sourceType:'module'}).body[0].declarations[0].init;
function transport(node){
  if(!node||typeof node!=='object')return node;
  if(Array.isArray(node))return node.map(transport);
  for(const key of Object.keys(node))node[key]=transport(node[key]);
  if(node.type==='MemberExpression'&&!node.computed&&node.object.name==='platform'&&node.property.name==='os')return expression('process.platform');
  const callee=node.type==='CallExpression'?node.callee:null;
  if(callee?.type==='Identifier'&&callee.name==='joinFileAttempts'){node.callee=expression('Promise.all');return node}
  if(callee?.type==='Identifier'&&callee.name==='reporter'){node.callee=expression('console.error');return node}
  if(callee?.type!=='MemberExpression'||callee.computed||callee.object.type!=='Identifier'||callee.property.type!=='Identifier')return node;
  const name=callee.object.name+'.'+callee.property.name;
  if(name==='jobs.run'){
    assert.equal(node.arguments.length,1);const command=node.arguments[0];
    assert.equal(command.type,'ArrowFunctionExpression');assert.equal(command.params.length,0);assert.equal(command.body.type,'CallExpression');
    assert.ok(['readCachedChequeImage','refreshCachedChequeImageDate','writeCachedChequeImage'].includes(command.body.callee.name));return command.body;
  }
  if(name==='browser.loadScrapers'){assert.equal(node.arguments.length,0);return expression("import('israeli-bank-scrapers')")}
  if(name==='browser.ensureProfile'){assert.equal(node.arguments.length,0);return expression('fs.mkdir(BROWSER_PROFILE_DIR,{recursive:true})')}
  if(name==='identity.directory'||name==='identity.remove'){
    assert.equal(node.arguments.length,1);const result=expression((name.endsWith('directory')?'creditIdentityDirectory':'deleteCreditIdentity')+'(CREDIT_IDENTITIES_DIR,profile)');result.arguments[1]=node.arguments[0];return result;
  }
  if(name==='diagnostics.report'){
    assert.equal(node.arguments.length,2);assert.equal(node.arguments[1].type,'Identifier');
    const variable=node.arguments[1].name;node.callee=expression('console.error');node.arguments[1]=expression(variable+'?.message||'+variable);return node;
  }
  if(name==='clock.now'){assert.equal(node.arguments.length,0);return expression('Date.now()')}
  if(name==='clock.date'){assert.equal(node.arguments.length,0);return expression('new Date()')}
  if(name==='platform.access'){node.callee=expression('fs.access');return node}
  if(name==='platform.where'){
    assert.equal(node.arguments.length,1);const result=expression("runProcess('where.exe',[name])");result.arguments[1].elements[0]=node.arguments[0];return result;
  }
  if(name==='clock.delay'){
    assert.equal(node.arguments.length,1);const result=expression('new Promise(resolve=>setTimeout(resolve,0))');result.arguments[0].body.arguments[1]=node.arguments[0];return result;
  }
  return node;
}

export function providerPolicyHashes(sources,names){
  const declarations=[];
  function visit(node){
    if(!node||typeof node!=='object')return;
    if(node.type==='FunctionDeclaration')declarations.push(node);
    for(const value of Object.values(node))if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object')visit(value);
  }
  sources.forEach(source=>visit(parse(source,{ecmaVersion:'latest',sourceType:'module'})));
  const out={};
  for(const name of names){
    const found=declarations.filter(node=>node.id?.name===name);assert.equal(found.length,1,`one canonical provider function: ${name}`);
    const node=structuredClone(found[0]);
    node.body.body=node.body.body.filter(statement=>!(statement.type==='IfStatement'&&statement.test.type==='Identifier'&&statement.test.name==='scrapeBusy')&&!(statement.type==='ExpressionStatement'&&statement.expression.type==='AssignmentExpression'&&statement.expression.left.name==='scrapeBusy'));
    if(name==='scrapeAllCreditProfiles'&&node.body.body[0].type==='TryStatement')node.body.body=node.body.body[0].block.body;
    if(name==='scrapeHapoalimSnapshot'){
      const statement=node.body.body.find(row=>row.type==='TryStatement');
      statement.finalizer.body=statement.finalizer.body.filter(row=>!(row.type==='ExpressionStatement'&&row.expression.type==='AssignmentExpression'&&row.expression.left.name==='scrapeBusy'));
    }
    const stable=JSON.stringify(transport(node),(key,value)=>['start','end','raw'].includes(key)?undefined:value);
    out[name]=createHash('sha256').update(stable).digest('hex');
  }
  return out;
}
