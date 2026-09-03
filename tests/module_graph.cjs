const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const acorn=require('acorn');
function walk(n,visit){if(!n?.type)return;visit(n);for(const x of Object.values(n))for(const v of Array.isArray(x)?x:[x])if(v?.type)walk(v,visit)}
for(const app of ['kupa','orders']){
  const site=path.resolve(`netunim-${app}/site`), files=[];
  function list(dir){for(const d of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,d.name);if(d.isDirectory())list(f);else if(f.endsWith('.js'))files.push(f)}}
  list(site);const graph=new Map();
  for(const file of files){
    const code=fs.readFileSync(file,'utf8'),relative=path.relative(site,file).split(path.sep).join('/');
    const ast=acorn.parse(code,{ecmaVersion:'latest',sourceType:'module'}),edges=[];
    assert.ok(!code.includes('__testBindings'),relative+': test API leaked into deployable source');
    assert.ok(!relative.startsWith('assets/')||Buffer.byteLength(code.replace(/\r\n/g,'\n'))<60000,relative+': oversized responsibility module');
    walk(ast,node=>{
      const string=node.type==='Literal'&&typeof node.value==='string'?node.value:node.type==='TemplateElement'?node.value.cooked:null;
      if(string!==null)assert.ok(!/(?:^|[\s<])on[a-z]+\s*=/i.test(string),relative+': executable event attribute in HTML fragment');
      if(node.type==='AssignmentExpression'&&node.left.type==='MemberExpression')assert.ok(!['window','globalThis'].includes(node.left.object.name),relative+': global compatibility assignment');
      if(node.type==='ImportExpression')assert.equal(node.source.type,'Literal',relative+': imports must have a statically verifiable graph');
      if(node.type==='ImportDeclaration'||node.type==='ExportAllDeclaration'||node.type==='ExportNamedDeclaration'&&node.source||node.type==='ImportExpression'){
        const spec=node.source.value;assert.ok(spec.startsWith('.'),relative+': runtime must use local relative imports');
        const target=path.resolve(path.dirname(file),spec);
        assert.ok(target.startsWith(site+path.sep)&&fs.existsSync(target),relative+': missing or cross-site dependency '+spec);edges.push(target);
      }
      if(/assets\/js\/(storage|cloud|sync)\//.test(relative)&&node.type==='Identifier')assert.notEqual(node.name,'document',relative+': DOM belongs behind a UI port');
      if(/\/(model|readout)\.js$/.test(relative)&&node.type==='Identifier')assert.ok(!['document','window','localStorage','fetch','indexedDB'].includes(node.name),relative+': calculation module has side effects');
    });
    graph.set(file,edges);
  }
  const visited=new Set(),active=new Set();
  function visit(file){assert.ok(!active.has(file),'Circular imports: '+path.relative(site,file));if(visited.has(file))return;active.add(file);for(const dep of graph.get(file)||[])visit(dep);active.delete(file);visited.add(file)}
  visit(path.join(site,'assets/app.js'));
  const unreachable=files.filter(f=>f.includes(path.join('assets','js'))&&!visited.has(f));
  assert.deepEqual(unreachable,[],app+': unused module files');
  assert.ok(fs.statSync(path.join(site,'assets/app.js')).size<2048,app+': entrypoint must remain small');
  console.log(`PASS ${app}: ${graph.size} modules, acyclic local graph, no inline attributes/globals/test API, isolated calculation and infrastructure layers`);
}
