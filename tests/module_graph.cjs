const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const acorn=require('acorn');
function walk(n,visit){if(!n?.type)return;visit(n);for(const x of Object.values(n))for(const v of Array.isArray(x)?x:[x])if(v?.type)walk(v,visit)}
for(const app of ['kupa','orders']){
  const site=path.resolve(`netunim-${app}/site`), files=[], htmlFiles=[];
  const vendorRoot=path.join(site,'assets','vendor');
  function list(dir){for(const d of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,d.name);if(d.isDirectory()){if(f===vendorRoot)continue;list(f)}else if(f.endsWith('.js'))files.push(f);else if(f.endsWith('.html'))htmlFiles.push(f)}}
  list(site);const graph=new Map();
  for(const file of files){
    const code=fs.readFileSync(file,'utf8'),relative=path.relative(site,file).split(path.sep).join('/');
    const ast=acorn.parse(code,{ecmaVersion:'latest',sourceType:'module'}),edges=[];
    assert.ok(!code.includes('__testBindings'),relative+': test API leaked into deployable source');
    assert.ok(!relative.startsWith('assets/')||Buffer.byteLength(code.replace(/\r\n/g,'\n'))<60000,relative+': oversized responsibility module');
    walk(ast,node=>{
      if(node.type==='FunctionDeclaration'&&node.id?.name==='createLifecycle'&&relative==='assets/js/lifecycle.js')
        assert.ok(node.params[0]?.type==='ObjectPattern'&&node.params[0].properties.length<=(app==='kupa'?34:24),relative+': startup collaborators must not grow; introduce a capability port');
      if(node.type==='FunctionDeclaration'&&['createStorageStartupRecovery','createKupaConnectivityRuntime','createOrdersConnectivityRuntime','createOrdersCloudStartup','createOrdersLocalServices','createOrdersBackgroundStartup'].includes(node.id?.name)){
        const parameter=node.params[0]?.type==='AssignmentPattern'?node.params[0].left:node.params[0];
        assert.ok(parameter?.type==='ObjectPattern'&&parameter.properties.length<=8,relative+': startup capability factory exceeds eight collaborators');
      }
      const string=node.type==='Literal'&&typeof node.value==='string'?node.value:node.type==='TemplateElement'?node.value.cooked:null;
      if(string!==null)assert.ok(!/(?:^|[\s<])on[a-z]+\s*=/i.test(string),relative+': executable event attribute in HTML fragment');
      if(node.type==='AssignmentExpression'&&node.left.type==='MemberExpression')assert.ok(!['window','globalThis'].includes(node.left.object.name),relative+': global compatibility assignment');
      if(node.type==='ImportExpression')assert.equal(node.source.type,'Literal',relative+': imports must have a statically verifiable graph');
      if(node.type==='NewExpression'&&node.callee.type==='Identifier'&&node.callee.name==='Worker'){
        const url=node.arguments[0];assert.ok(url?.type==='NewExpression'&&url.callee?.type==='Identifier'&&url.callee.name==='URL',relative+': Worker entrypoint must use new URL(relative, import.meta.url)');
        const spec=url.arguments[0];assert.equal(spec?.type,'Literal',relative+': Worker entrypoint must be statically verifiable');assert.ok(String(spec.value||'').startsWith('.'),relative+': Worker entrypoint must be local and relative');
        const target=path.resolve(path.dirname(file),String(spec.value));assert.ok(target.startsWith(site+path.sep)&&fs.existsSync(target),relative+': missing or cross-site Worker dependency '+spec.value);edges.push(target);
      }
      if(node.type==='ImportDeclaration'||node.type==='ExportAllDeclaration'||node.type==='ExportNamedDeclaration'&&node.source||node.type==='ImportExpression'){
        const spec=node.source.value;assert.ok(spec.startsWith('.'),relative+': runtime must use local relative imports');
        const target=path.resolve(path.dirname(file),spec);
        assert.ok(target.startsWith(site+path.sep)&&fs.existsSync(target),relative+': missing or cross-site dependency '+spec);edges.push(target);
        const dependency=path.relative(path.join(site,'assets','js'),target).split(path.sep).join('/');
        if(/^assets\/js\/(storage|cloud|sync)\//.test(relative)){
          assert.ok(!/^((domains|ui)\/)/.test(dependency),relative+': infrastructure must receive domain/UI behavior through composition ports: '+dependency);
        }
        if(relative==='assets/js/lifecycle.js')
          assert.ok(!dependency.startsWith('domains/'),relative+': startup must use capability ports instead of importing business helpers: '+dependency);
        if(relative.startsWith('assets/js/startup/'))
          assert.ok(!/^(domains|ui|storage|cloud|sync|integrations|platform)\//.test(dependency),relative+': startup orchestration must receive concrete adapters and business/UI behavior through ports: '+dependency);
        if(relative.startsWith('assets/js/state/'))
          assert.ok(!/^(domains|sync)\//.test(dependency),relative+': state must use contracts or composition ports: '+dependency);
        if(relative.startsWith('assets/js/domains/'))
          assert.ok(!dependency.startsWith('ui/'),relative+': domains must use shared presentation primitives or UI ports: '+dependency);
      }
      if(/assets\/js\/(storage|cloud|sync)\//.test(relative)&&node.type==='Identifier')assert.notEqual(node.name,'document',relative+': DOM belongs behind a UI port');
      if(relative.startsWith('assets/js/startup/')&&node.type==='Identifier')assert.ok(!['window','document','navigator','localStorage','fetch','indexedDB','setTimeout','setInterval','clearTimeout','clearInterval'].includes(node.name),relative+': startup I/O belongs behind a port');
      if(/\/(model|readout)\.js$/.test(relative)&&node.type==='Identifier')assert.ok(!['document','window','localStorage','fetch','indexedDB'].includes(node.name),relative+': calculation module has side effects');
    });
    graph.set(file,edges);
  }
  const visited=new Set(),active=new Set();
  function visit(file){assert.ok(!active.has(file),'Circular imports: '+path.relative(site,file));if(visited.has(file))return;active.add(file);for(const dep of graph.get(file)||[])visit(dep);active.delete(file);visited.add(file)}
  const entrypoints=new Set([path.join(site,'assets/app.js')]);
  const attr=(tag,name)=>tag.match(new RegExp(`\\b${name}\\s*=\\s*[\"']([^\"']+)[\"']`,'i'))?.[1]||null;
  for(const html of htmlFiles){
    const source=fs.readFileSync(html,'utf8');
    for(const match of source.matchAll(/<script\b[^>]*>/gi)){
      const type=attr(match[0],'type'),src=attr(match[0],'src');
      if(type?.toLowerCase()!=='module'||!src)continue;
      assert.ok(src.startsWith('.'),path.relative(site,html)+': module entrypoint must be local and relative');
      const target=path.resolve(path.dirname(html),src.split(/[?#]/)[0]);
      assert.ok(target.startsWith(site+path.sep)&&fs.existsSync(target),path.relative(site,html)+': missing or cross-site module entrypoint '+src);
      entrypoints.add(target);
    }
  }
  for(const entrypoint of entrypoints)visit(entrypoint);
  const unreachable=files.filter(f=>f.includes(path.join('assets','js'))&&!visited.has(f));
  assert.deepEqual(unreachable,[],app+': unused module files');
  assert.ok(fs.statSync(path.join(site,'assets/app.js')).size<2048,app+': entrypoint must remain small');
  console.log(`PASS ${app}: ${graph.size} modules, acyclic local graph, no inline attributes/globals/test API, isolated calculation and infrastructure layers`);
}
