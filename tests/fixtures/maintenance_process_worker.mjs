import {documentBridgeSource} from '../document_bridge_source.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {runMaintenanceWorker} from '../../netunim-orders/document-bridge/maintenance-process-owner.mjs';
import {createMaintenanceWorkerPlatform} from '../../netunim-orders/document-bridge/maintenance-process-platform.mjs';

const [requestedMode,root]=process.argv.slice(2),mode=requestedMode==='--refresh-pdf-index'?'normal':requestedMode;
const send=value=>new Promise(resolve=>process.send(value,resolve));
try {
  if(mode==='production-init-failure'){
    const {source,ast}=documentBridgeSource();
    const declaration=ast.body.find(node=>node.type==='FunctionDeclaration'&&node.id.name==='main');
    const main=vm.runInNewContext(source.slice(declaration.start,declaration.end)+'\nmain',{
      process,runMaintenanceWorker,createMaintenanceWorkerPlatform,privateNodeRuntimeInfoSync:()=>{},
      init:async()=>{throw new Error('synthetic maintenance init failure')},
    });
    const saved=process.argv;process.argv=['node','synthetic','--refresh-pdf-index'];
    try { await main(); } finally { process.argv=saved; }
  }else{
    let stopped=false;let resolveStopped,resolveRelease;
    const stopping=new Promise(resolve=>{resolveStopped=resolve}),released=new Promise(resolve=>{resolveRelease=resolve});
    const release=message=>{if(message==='release-commit')resolveRelease()};process.on('message',release);
    try {
      await runMaintenanceWorker(createMaintenanceWorkerPlatform({requestStop:()=>{stopped=true;resolveStopped();void send({kind:'stopping'}).catch(()=>{})}}),async()=>{
        await send({kind:'ready'});
        if(mode==='commit'){
          await stopping;await released;await fs.appendFile(path.join(root,'commits.txt'),'one retained commit\n');
        }else await stopping;
        await send({type:'pdf-maintenance-result',result:{processed:mode==='commit'?1:0,aborted:stopped}});
      });
    } finally { process.removeListener('message',release); }
  }
} catch(error) { console.error(error.message);process.exitCode=1; }
