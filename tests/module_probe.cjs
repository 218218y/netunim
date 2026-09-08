// Test-only lexical probes in temporary copies. No globals or test API are shipped.
const fs = require('node:fs');
const path = require('node:path');
const acorn = require('acorn');
const scope = require('eslint-scope');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const parse = source => acorn.parse(source, {ecmaVersion:'latest', sourceType:'module', ranges:true});
function names(pattern) {
  if (!pattern) return [];
  if (pattern.type==='Identifier') return [pattern.name];
  if (pattern.type==='ObjectPattern') return pattern.properties.flatMap(p=>names(p.value||p.argument));
  if (pattern.type==='ArrayPattern') return pattern.elements.flatMap(names);
  if (pattern.type==='AssignmentPattern') return names(pattern.left);
  if (pattern.type==='RestElement') return names(pattern.argument);
  return [];
}
if (input.mode==='instrument') {
  const inventory = new Set(), modules=[];
  const contextPath=path.join(input.site,'assets/js/state/contexts.js');
  const contextFields=fs.existsSync(contextPath)?parse(fs.readFileSync(contextPath,'utf8')).body[0].declaration.body.body.find(n=>n.type==='ReturnStatement').argument.properties.flatMap(p=>p.value.properties.map(f=>[f.key.name,p.key.name])):[];
  function visit(dir) {
    for (const entry of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))) {
      const file=path.join(dir,entry.name);
      if(entry.isDirectory())visit(file);
      else if(file.endsWith('.js')) {
        let source=fs.readFileSync(file,'utf8');const bindings=[], factoryEdits=[];
        const functionNode=n=>n&&['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression'].includes(n.type);
        const keyName=p=>p.computed?(p.key.type==='Literal'?String(p.key.value):null):(p.key.name??String(p.key.value));
        function objectMethods(object){
          if(object?.type!=='ObjectExpression')return;
          for(const property of object.properties){
            if(property.type==='SpreadElement'){objectMethods(property.argument);continue}
            const key=keyName(property);
            if(key!==null&&(functionNode(property.value)||property.value.type==='MemberExpression'))inventory.add(key);
            objectMethods(property.value);
          }
        }
        function instrumentFunction(fn){
          const locals=new Map();
          for(const statement of fn.body.body||[]){
            if(statement.type==='FunctionDeclaration')locals.set(statement.id.name,{value:statement,mutable:true});
            if(statement.type==='VariableDeclaration')for(const dec of statement.declarations)if(dec.id.type==='Identifier')locals.set(dec.id.name,{value:dec.init,mutable:statement.kind!=='const'});
          }
          function resolve(n,seen=new Set()){
            if(n?.type!=='Identifier'||seen.has(n.name))return n;
            seen.add(n.name);return resolve(locals.get(n.name)?.value,seen)||n;
          }
          function publicShape(expression){
            const object=resolve(expression),setters=[];
            if(object?.type==='ObjectExpression')for(const property of object.properties){
              if(property.type==='SpreadElement'){publicShape(property.argument);continue}
              const key=keyName(property),value=resolve(property.value);
              if(key!==null&&(functionNode(value)||property.value.type==='MemberExpression'))inventory.add(key);
              if(property.value.type==='Identifier'&&functionNode(value)&&locals.get(property.value.name)?.mutable)setters.push(`${JSON.stringify(key)}:v=>${property.value.name}=v`);
              if(value?.type==='ObjectExpression')publicShape(value);
            }
            return setters;
          }
          function wrap(expression){
            const setters=publicShape(expression);
            factoryEdits.push([expression.start,expression.end,`(__capturePublicApi(${source.slice(expression.start,expression.end)}, {${setters.join(',')}}))`]);
          }
          function returns(node){
            if(!node||functionNode(node))return;
            if(node.type==='ReturnStatement'&&node.argument){wrap(node.argument);return}
            for(const value of Object.values(node))for(const child of Array.isArray(value)?value:[value])if(child?.type)returns(child);
          }
          if(fn.body.type==='BlockStatement')returns(fn.body);else wrap(fn.body);
        }
        for(let node of parse(source).body) {
          if(node.type==='ExportNamedDeclaration'||node.type==='ExportDefaultDeclaration')node=node.declaration;
          if(!node)continue;
          if(node.type==='VariableDeclaration')for(const dec of node.declarations){
            for(const name of names(dec.id))bindings.push([name,node.kind!=='const']);
            if(functionNode(dec.init))instrumentFunction(dec.init);
            else if(dec.init&&['CallExpression','ObjectExpression'].includes(dec.init.type)){
              objectMethods(dec.init);
              factoryEdits.push([dec.init.start,dec.init.end,`__capturePublicApi(${source.slice(dec.init.start,dec.init.end)})`]);
            }
          }
          if(node.type==='FunctionDeclaration'){
            if(node.id)bindings.push([node.id.name,true]);
            instrumentFunction(node);
          }
          if(['FunctionExpression','ArrowFunctionExpression'].includes(node.type))instrumentFunction(node);
        }
        for(const[a,b,replacement]of factoryEdits.sort((a,b)=>b[0]-a[0]))source=source.slice(0,a)+replacement+source.slice(b);
        if(!bindings.length&&!factoryEdits.length)continue;
        for(const [name]of bindings)inventory.add(name);
        const extras=[];
        if(file.endsWith(path.join('js','main.js'))){
          for(const[n,c]of contextFields){inventory.add(n);extras.push(`get ${n}(){return ${c}.${n}},set ${n}(v){${c}.${n}=v}`)}
        }
        source+='\nexport const __testBindings={\n'+[...bindings.map(([n,mutable])=>`get ${n}(){return ${n}}${mutable?`,set ${n}(v){${n}=v}`:''}`),...extras].join(',\n')+'\n};\n';
        const helper=path.relative(path.dirname(file),path.join(input.site,'test-probe-runtime.js')).split(path.sep).join('/');
        source=`import {capturePublicApi as __capturePublicApi} from ${JSON.stringify(helper.startsWith('.')?helper:'./'+helper)};\n`+source;
        fs.writeFileSync(file,source);
        modules.push('./'+path.relative(input.site,file).split(path.sep).join('/'));
      }
    }
  }
  visit(path.join(input.site,'assets'));
  fs.copyFileSync(path.join(__dirname,'module_probe_runtime.mjs'),path.join(input.site,'test-probe-runtime.js'));
  // Public convenience names must not shadow host APIs (for example an action
  // map can have a method named "document"). Such methods remain on their API object.
  fs.writeFileSync(path.join(input.site,'test-access.js'),`import {publicBindings} from './test-probe-runtime.js';\n`+modules.map((m,i)=>`import {__testBindings as b${i}} from ${JSON.stringify(m)};`).join('\n')+'\nconst lexical={};\n'+modules.map((_,i)=>`Object.defineProperties(lexical,Object.getOwnPropertyDescriptors(b${i}));`).join('\n')+`\nconst owner=(target,key)=>Reflect.has(target,key)?target:Reflect.has(globalThis,key)?globalThis:publicBindings;\nexport const bindings=new Proxy(lexical,{get:(target,key)=>Reflect.get(owner(target,key),key),set:(target,key,value)=>Reflect.set(owner(target,key),key,value)});\n`);
  console.log(JSON.stringify([...inventory]));
} else {
  const ast=parse(input.expression), parents=new Map();
  function walk(node) {
    for(const value of Object.values(node))for(const child of Array.isArray(value)?value:[value])if(child&&typeof child==='object'&&child.type){parents.set(child,node);walk(child)}
  }
  walk(ast);
  const manager=scope.analyze(ast,{ecmaVersion:2024,sourceType:'module'}), known=new Set(input.names), edits=[];
  for(const {identifier:id}of manager.globalScope.through)if(known.has(id.name)){
    const parent=parents.get(id), shorthand=parent?.type==='Property'&&parent.shorthand;
    edits.push([id.start,id.end,(shorthand?id.name+':':'')+'__netunimProbe.'+id.name]);
  }
  let result=input.expression;
  for(const [a,b,replacement]of edits.sort((a,b)=>b[0]-a[0]))result=result.slice(0,a)+replacement+result.slice(b);
  console.log(JSON.stringify(result));
}
