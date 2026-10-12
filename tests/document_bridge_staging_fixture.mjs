import fs from 'node:fs/promises';
import path from 'node:path';
import {parse} from 'acorn';

// Isolated native worker fixtures stage code by actual static dependencies,
// independently of the installer list. Dynamic vendored runtimes stay explicit.
export async function stageBridgeModules(sourceDirectory,targetDirectory,entries){
  const sourceRoot=path.resolve(sourceDirectory),targetRoot=path.resolve(targetDirectory),seen=new Set();
  function within(root,value){const resolved=path.resolve(root,value),relative=path.relative(root,resolved);if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw new Error('bridge_fixture_module_outside_root');return {resolved,relative}}
  async function visit(file){
    const source=within(sourceRoot,file),target=within(targetRoot,source.relative);if(seen.has(source.relative))return;seen.add(source.relative);
    const text=await fs.readFile(source.resolved,'utf8'),program=parse(text,{ecmaVersion:'latest',sourceType:'module'});
    await fs.mkdir(path.dirname(target.resolved),{recursive:true});await fs.copyFile(source.resolved,target.resolved);
    for(const node of program.body){
      if(!['ImportDeclaration','ExportNamedDeclaration','ExportAllDeclaration'].includes(node.type)||!node.source||!String(node.source.value).startsWith('.'))continue;
      await visit(path.join(path.dirname(source.relative),String(node.source.value)));
    }
  }
  for(const entry of entries)await visit(entry);return seen;
}
