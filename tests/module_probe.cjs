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
    for (const entry of fs.readdirSync(dir,{withFileTypes:true})) {
      const file=path.join(dir,entry.name);
      if(entry.isDirectory())visit(file);
      else if(file.endsWith('.js')) {
        let source=fs.readFileSync(file,'utf8');const bindings=[], instances=[], factoryEdits=[];
        for(let node of parse(source).body) {
          if(node.type==='ExportNamedDeclaration')node=node.declaration;
          if(!node)continue;
          if(node.type==='VariableDeclaration')for(const dec of node.declarations){
            for(const name of names(dec.id))bindings.push([name,node.kind!=='const']);
            if(dec.id.type==='Identifier'&&dec.init?.type==='CallExpression'&&/^create/.test(dec.init.callee.name||''))instances.push(dec.id.name);
          }
          if(node.type==='FunctionDeclaration'){
            bindings.push([node.id.name,true]);
            if(/^create/.test(node.id.name)){
              const functions=node.body.body.filter(n=>n.type==='FunctionDeclaration').map(n=>n.id.name);
              const ret=node.body.body.findLast(n=>n.type==='ReturnStatement');
              if(functions.length&&ret){
                functions.forEach(n=>inventory.add(n));
                factoryEdits.push([ret.start,ret.end,'const __testApi='+source.slice(ret.argument.start,ret.argument.end)+';\nObject.defineProperty(__testApi,"__testBindings",{value:{'+functions.map(n=>`get ${n}(){return ${n}},set ${n}(v){${n}=v;__testApi.${n}=v}`).join(',')+'}});\nreturn __testApi;']);
              }
            }
          }
        }
        for(const[a,b,replacement]of factoryEdits.sort((a,b)=>b[0]-a[0]))source=source.slice(0,a)+replacement+source.slice(b);
        if(!bindings.length)continue;
        for(const [name]of bindings)inventory.add(name);
        const extras=[];
        if(file.endsWith(path.join('js','main.js'))){
          for(const[n,c]of contextFields){inventory.add(n);extras.push(`get ${n}(){return ${c}.${n}},set ${n}(v){${c}.${n}=v}`)}
        }
        source+='\nexport const __testBindings={\n'+[...bindings.map(([n,mutable])=>`get ${n}(){return ${n}}${mutable?`,set ${n}(v){${n}=v}`:''}`),...extras].join(',\n')+'\n};\n';
        for(const n of instances)source+=`if(${n}.__testBindings)Object.defineProperties(__testBindings,Object.getOwnPropertyDescriptors(${n}.__testBindings));\n`;
        fs.writeFileSync(file,source);
        modules.push('./'+path.relative(input.site,file).split(path.sep).join('/'));
      }
    }
  }
  visit(path.join(input.site,'assets'));
  fs.writeFileSync(path.join(input.site,'test-access.js'),modules.map((m,i)=>`import {__testBindings as b${i}} from ${JSON.stringify(m)};`).join('\n')+'\nexport const bindings={};\n'+modules.map((_,i)=>`Object.defineProperties(bindings,Object.getOwnPropertyDescriptors(b${i}));`).join('\n'));
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
