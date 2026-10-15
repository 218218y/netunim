import fs from 'node:fs';
import {parse} from 'acorn';

// Locate actual production declarations across composition owners. Original
// immutable policy fixtures remain separate; no production source is copied.
export function documentBridgeSource() {
  const files=[['server.mjs',null],['document-operations.mjs','createDocumentOperations'],['bridge-service.mjs','createBridgeService'],['pdf-index-coordinator.mjs','createPdfIndexCoordinator'],['everything-search-coordinator.mjs','createEverythingSearchCoordinator']];
  let source='';const body=[];
  for(const [file,factory] of files) {
    const text=fs.readFileSync(new URL('../netunim-orders/document-bridge/'+file,import.meta.url),'utf8');
    const ast=parse(text,{ecmaVersion:'latest',sourceType:'module'});
    let nodes=ast.body;
    if(factory) {
      const declaration=ast.body.find(node=>node.type==='ExportNamedDeclaration'&&node.declaration?.id?.name===factory)?.declaration;
      if(!declaration)throw new Error('missing production factory: '+factory);
      nodes=declaration.body.body.filter(node=>node.type!=='VariableDeclaration'||node.declarations.every(item=>['CallExpression','NewExpression','ArrowFunctionExpression'].includes(item.init?.type)));
    }
    for(const node of nodes)body.push({...node,start:node.start+source.length,end:node.end+source.length});
    source+=text+'\n';
  }
  return {source,ast:{body}};
}
