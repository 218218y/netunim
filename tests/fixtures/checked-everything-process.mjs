import {createEverythingProcess} from '../../netunim-orders/document-bridge/everything-process.mjs';
import {createEverythingDiscovery} from '../../netunim-orders/document-bridge/everything-discovery.mjs';
/** @type {import('../../netunim-orders/document-bridge/everything-process.mjs').ProcessPorts} */
const host={commands:{execute:async()=>({stdout:''}),launch:async()=>{}}};
const processes=createEverythingProcess(host);processes.es('es.exe',[],{timeout:15000,signal:new AbortController().signal});
/** @type {Promise<void>} */const closed=processes.dispose();void closed;
// @ts-expect-error native command output is text
createEverythingProcess({commands:{...host.commands,execute:async()=>({stdout:7})}});
// @ts-expect-error process launch must acknowledge spawn or reject before it is considered joined
createEverythingProcess({commands:{...host.commands,launch:()=>undefined}});
// @ts-expect-error command timeouts are milliseconds
processes.command('where.exe',[],'3s');
/** @type {import('../../netunim-orders/document-bridge/everything-discovery.mjs').DiscoveryPorts} */
const ports={locations:{esCandidates:[],direct:()=>[],registryKeys:[],known:[],windows:true},files:{exists:async()=>true},commands:{where:async()=>'',registry:async()=>''},paths:{executables:()=>[]}};
const discovery=createEverythingDiscovery(ports);discovery.es();
/** @type {Promise<void>} */const disposed=discovery.dispose();void disposed;
// @ts-expect-error a complete known configuration must precede application discovery
discovery.executable(/** @type {unknown} */({everythingExecutable:'app.exe'}));
// @ts-expect-error asynchronous path projection cannot authorize an executable
createEverythingDiscovery({...ports,paths:{executables:async()=>['Everything.exe']}});
// @ts-expect-error file existence evidence is boolean
createEverythingDiscovery({...ports,files:{exists:async()=> 'yes'}});
