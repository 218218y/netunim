const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const acorn=require('acorn');
function walk(n,visit,parent=null){if(!n?.type)return;visit(n,parent);for(const x of Object.values(n))for(const v of Array.isArray(x)?x:[x])if(v?.type)walk(v,visit,n)}
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
    walk(ast,(node,parent)=>{
      if(app==='kupa'&&relative==='assets/js/main.js'&&node.type==='Identifier')
        assert.notEqual(node.name,'domainsCreditController',relative+': Credit consumers require capability role ports');
      if(node.type==='FunctionDeclaration'&&['createBankBridgeClient','createDocumentBridgeClient','createBrowserBridgePlatform','createBankBridgeIntegration','createFinanceBridgeIntegration','createDocumentBridgeIntegration','createGoogleDriveClient','createBrowserGoogleDrivePlatform','createDocumentGoogleDriveIntegration','composeDocumentSearch'].includes(node.id?.name)){
        const parameter=node.params[0]?.type==='AssignmentPattern'?node.params[0].left:node.params[0];
        assert.ok(parameter?.type==='ObjectPattern'&&parameter.properties.length<=5,relative+': Bridge factory exceeds five collaborators');
      }
      if(node.type==='FunctionDeclaration'&&node.id?.name==='createLifecycle'&&relative==='assets/js/lifecycle.js')
        assert.ok(node.params[0]?.type==='ObjectPattern'&&node.params[0].properties.length<=(app==='kupa'?23:24),relative+': startup collaborators must not grow; introduce a capability port');
      if(node.type==='FunctionDeclaration'&&node.id?.name==='createPollingTask'&&relative==='assets/js/shared/runtime-polling.js')
        assert.ok(node.params[0]?.type==='ObjectPattern'&&node.params[0].properties.length<=6,relative+': recurring task owner exceeds six collaborators');
      if(node.type==='FunctionDeclaration'&&node.id?.name==='createDebouncedTask'&&relative==='assets/js/shared/debounced-task.js')
        assert.ok(node.params[0]?.type==='ObjectPattern'&&node.params[0].properties.length<=3,relative+': debounced task owner exceeds three collaborators');
      if(node.type==='FunctionDeclaration'&&node.id?.name==='createKupaBankCapability')
        assert.ok(node.params[0]?.type==='ObjectPattern'&&node.params[0].properties.length<=10,relative+': Bank composition requires focused capability ports');
      if(node.type==='FunctionDeclaration'&&node.id?.name==='createKupaDashboardCapability')
        assert.ok(node.params[0]?.type==='ObjectPattern'&&node.params[0].properties.length<=7,relative+': Dashboard composition requires focused ports');
      if(node.type==='FunctionDeclaration'&&['createDomainsDashboardController','createDomainsDashboardView'].includes(node.id?.name)&&app==='kupa')
        assert.ok(node.params[0]?.type==='ObjectPattern'&&node.params[0].properties.length<=6,relative+': Dashboard read/view owner exceeds six collaborators');
      if(node.type==='FunctionDeclaration'&&node.id?.name==='createKupaCreditRuntime')
        assert.ok(node.params[0]?.type==='ObjectPattern'&&node.params[0].properties.length<=3,relative+': Credit composition requires model, UI and platform ports');
      if(app==='kupa'&&relative==='assets/js/composition/credit.js'&&node.type==='FunctionDeclaration'&&node.id?.name==='bindServices')
        assert.ok(node.params[0]?.type==='ObjectPattern'&&node.params[0].properties.length<=5,relative+': Credit services require focused ports');
      if(node.type==='FunctionDeclaration'&&node.id?.name==='createKupaBankQueries')
        assert.ok(node.params[0]?.type==='ObjectPattern'&&node.params[0].properties.length<=2,relative+': Bank queries should only read model and checks observations');
      if(node.type==='FunctionDeclaration'&&node.id?.name==='createOrdersChecksCapability')
        assert.ok(node.params[0]?.type==='ObjectPattern'&&node.params[0].properties.length<=10,relative+': Checks composition requires focused ports');
      if(node.type==='FunctionDeclaration'&&node.id?.name==='createOrdersFinanceCapability')
        assert.ok(node.params[0]?.type==='ObjectPattern'&&node.params[0].properties.length<=9,relative+': Finance composition requires focused ports, not another app context');
      if(node.type==='FunctionDeclaration'&&node.id?.name==='createFinanceBrowserEffects'){
        const parameter=node.params[0]?.type==='AssignmentPattern'?node.params[0].left:node.params[0];
        assert.ok(parameter?.type==='ObjectPattern'&&parameter.properties.length<=2,relative+': Finance browser effects exceed two platform collaborators');
      }
      const resourceKey=node.type==='MemberExpression'?node.property?.name:relative==='assets/js/state/contexts.js'&&node.type==='Property'?node.key?.name:null;
      if(['cloudSavePromise','storageV2CloudSavePromise','cloudPollTimer','cloudRecoveryTimer','cloudRecoveryAttempt','saveQueue','autoBackupTimer','pendingAutoBackupPayload','startupLocalServicesPromise','primaryLockRelease'].includes(resourceKey))
        assert.fail(relative+': Main cloud/save resources belong to their explicit owners');
      if(relative==='assets/js/shared/tab-lock.js'&&node.type==='FunctionDeclaration'&&node.id?.name==='createPrimaryTabLock')
        assert.ok(node.params[0]?.type==='ObjectPattern'&&node.params[0].properties.length<=5,relative+': primary lock ownership requires focused authority/platform ports');
      if(relative==='assets/js/shared/tab-lock.js'&&node.type==='Identifier'&&!(parent?.type==='MemberExpression'&&parent.property===node&&!parent.computed))
        assert.ok(!['window','navigator','localStorage','sessionStorage','crypto','BroadcastChannel','setTimeout','setInterval','clearTimeout','clearInterval'].includes(node.name),relative+': primary ownership uses explicit browser adapter ports');
      if(app==='orders'&&['folderWritePrepared','folderWritePending','folderForceBackupPending','folderWritePromise'].includes(resourceKey))
        assert.fail(relative+': working-file coordination belongs to its private selection/runtime');
      if(app==='orders'&&relative==='assets/js/storage/files.js'&&node.type==='Identifier')
        assert.ok(!['setTimeout','clearTimeout','setInterval','clearInterval'].includes(node.name),relative+': working-file retries must be owned by the serialized runtime');
      if(app==='orders'&&relative==='assets/js/storage/folder-write-runtime.js'&&node.type==='Identifier')
        assert.ok(!['window','document','navigator','fetch','localStorage','indexedDB','setTimeout','setInterval'].includes(node.name),relative+': working-file owner requires explicit I/O ports');
      if(app==='orders'&&node.type==='FunctionDeclaration'&&['createFolderWriteRuntime','createUiFolders','createOrdersFolderCapability','createStorageFiles'].includes(node.id?.name)){
        const limit={createFolderWriteRuntime:5,createUiFolders:5,createOrdersFolderCapability:7,createStorageFiles:8}[node.id.name];
        assert.ok(node.params[0]?.type==='ObjectPattern'&&node.params[0].properties.length<=limit,relative+': folder capability/owner exceeds its focused collaborator budget');
      }
      if(app==='orders'&&relative==='assets/js/ui/folders.js'&&node.type==='Identifier')
        assert.ok(!['window','document','navigator','showDirectoryPicker','localStorage','indexedDB','setTimeout','setInterval'].includes(node.name),relative+': folder commands require native picker and persistence ports');
      if(node.type==='FunctionDeclaration'&&node.id?.name==='createAutomaticBackupRuntime')
        assert.ok(node.params[0]?.type==='ObjectPattern'&&node.params[0].properties.length<=5,relative+': automatic backup owner requires focused ports');
      if(relative==='assets/js/storage/backup.js'&&node.type==='FunctionDeclaration'&&node.id?.name==='createStorageBackup'){
        assert.ok(node.params[0]?.type==='ObjectPattern'&&node.params[0].properties.length<=(app==='kupa'?7:3),relative+': backup adapter collaborators must stay focused');
        const api=node.body.body.findLast(statement=>statement.type==='ReturnStatement')?.argument;
        assert.ok(api?.type==='ObjectExpression'&&api.properties.length<=(app==='kupa'?9:5),relative+': backup public API must not expose private retention/naming helpers');
      }
      if(relative==='assets/js/storage/backup.js'&&node.type==='Identifier'&&!(parent?.type==='MemberExpression'&&parent.property===node&&!parent.computed))
        assert.ok(!['setTimeout','clearTimeout','setInterval','clearInterval'].includes(node.name),relative+': backup scheduling belongs to the runtime owner');
      if(app==='orders'&&node.type==='MemberExpression'&&['saveTimer','sharedChecksSaveTimer','checksPullPromise','checksSavePromise'].includes(node.property?.name))
        assert.fail(relative+': save and Checks sync resources belong to their runtimes, not context fields');
      if(app==='kupa'&&node.type==='MemberExpression'&&['ordersFinanceReadPromise','sharedChecksSaveTimer','sharedChecksSavePromise','sharedChecksPullPromise'].includes(node.property?.name))
        assert.fail(relative+': Dashboard flights belong to the readout owner');
      if(node.type==='FunctionDeclaration'&&node.id?.name==='createFinanceOperationScope')
        assert.ok(node.params[0]?.type==='ObjectPattern'&&node.params[0].properties.length===1,relative+': finance operation scope must receive one explicit access snapshot port');
      if(node.type==='FunctionDeclaration'&&['createStorageStartupRecovery','createKupaConnectivityRuntime','createOrdersConnectivityRuntime','createOrdersCloudStartup','createOrdersLocalServices','createOrdersBackgroundStartup','createKupaCloudStartup','createKupaLocalServices','createKupaConnectionStartup'].includes(node.id?.name)){
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
        if(app==='kupa'&&relative==='assets/js/main.js')assert.ok(!/^(domains\/dashboard\/|domains\/(?:bank|credit)\/(?:selectors|controller|view|editor)\.js$)/.test(dependency),relative+': Dashboard and Bank selectors belong behind capability/query ports');
        if(app==='kupa'&&relative==='assets/js/composition/finance.js')assert.notEqual(dependency,'domains/credit/controller.js',relative+': Credit controller belongs to its capability');
        if(app==='kupa'&&relative==='assets/js/main.js')assert.notEqual(dependency,'shared/credit-card-order-view.js',relative+': Credit order presentation belongs to its capability');
        if(app==='orders'&&relative==='assets/js/main.js')assert.ok(!/^(domains\/(finance|bank|checks)\/|integrations\/bank-bridge\.js|shared\/(finance-fence|finance-connection-import|credit-card-order-view)\.js)/.test(dependency),relative+': Finance and Checks internals belong to their capability compositions');
        if(relative==='assets/js/main.js')assert.ok(!/^sync\/checks(?:-persistence|-merge|-state)?\.js$/.test(dependency),relative+': Checks sync belongs to its capability');
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
        if(relative.startsWith('assets/js/domains/'))
          assert.ok(!/^(integrations|platform)\//.test(dependency)&&!['shared/bank-bridge-client.js','shared/document-bridge-client.js','shared/browser-bridge-platform.js','shared/google-drive-client.js','shared/browser-google-drive-platform.js'].includes(dependency),relative+': domains must receive Bridge/platform implementations through ports: '+dependency);
      }
      if(/assets\/js\/(storage|cloud|sync)\//.test(relative)&&node.type==='Identifier')assert.notEqual(node.name,'document',relative+': DOM belongs behind a UI port');
      if(relative==='assets/js/lifecycle.js'&&node.type==='Identifier')assert.notEqual(node.name,'document',relative+': lifecycle must receive DOM bindings through a port');
      if(relative.startsWith('assets/js/startup/')&&node.type==='Identifier')assert.ok(!['window','document','navigator','localStorage','fetch','indexedDB','setTimeout','setInterval','clearTimeout','clearInterval'].includes(node.name),relative+': startup I/O belongs behind a port');
      if(/\/(model|readout)\.js$/.test(relative)&&node.type==='Identifier')assert.ok(!['document','window','localStorage','fetch','indexedDB'].includes(node.name),relative+': calculation module has side effects');
      if(relative.endsWith('/shared/cloud-checkpoint-publication.js')&&node.type==='Identifier')assert.ok(!['document','window','navigator','localStorage','fetch','indexedDB','setTimeout','setInterval'].includes(node.name),relative+': cloud publication must use explicit ports');
      if(relative==='assets/js/domains/credit/controller.js'&&node.type==='Identifier')
        assert.notEqual(node.name,'localStorage',relative+': Credit preferences require an explicit port');
      if(app==='kupa'&&['assets/js/domains/bank/controller.js','assets/js/domains/credit/controller.js'].includes(relative)&&node.type==='Identifier'&&!(parent?.type==='MemberExpression'&&parent.property===node&&!parent.computed))
        assert.ok(!['document','window','navigator','Blob','URL','setTimeout','clearTimeout','setInterval','clearInterval'].includes(node.name),relative+': Bank/Credit forms/downloads and timer implementations belong behind ports');
      if(app==='kupa'&&relative==='assets/js/domains/dashboard/controller.js'&&node.type==='Identifier'&&!(parent?.type==='MemberExpression'&&parent.property===node&&!parent.computed))
        assert.ok(!['globalThis','window','document','navigator','Date','localStorage','fetch','setTimeout','setInterval'].includes(node.name),relative+': Dashboard reads use access/remote/clock ports');
      if(app==='orders'&&['assets/js/domains/finance/controller.js','assets/js/domains/bank/cache.js'].includes(relative)&&node.type==='Identifier'&&!(parent?.type==='MemberExpression'&&parent.property===node&&!parent.computed))
        assert.ok(!['globalThis','window','navigator','document','Blob','URL','setTimeout','clearTimeout'].includes(node.name),relative+': Finance orchestration uses explicit browser ports');
      if(/\/(?:shared\/(?:(bank|document)-bridge-client|google-drive-client|google-drive-document-policy|authenticated-account-scope)|domains\/documents\/search-source)\.js$/.test(relative)&&node.type==='Identifier'&&!(parent?.type==='MemberExpression'&&parent.property===node&&!parent.computed))
        assert.ok(!['globalThis','window','document','navigator','localStorage','fetch','AbortController','setTimeout','clearTimeout','setInterval','clearInterval'].includes(node.name),relative+': canonical Bridge client must use injected I/O ports');
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
