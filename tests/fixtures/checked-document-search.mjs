import {createDocumentSearch} from '../../netunim-orders/document-bridge/search-owner.mjs';
import {createDocumentResultRegistry} from '../../netunim-orders/document-bridge/result-registry.mjs';

/** @type {import('../../netunim-orders/document-bridge/result-registry.mjs').DocumentRow} */
const row={name:'synthetic.pdf',fullPath:'C:\\synthetic.pdf',relativePath:'C:\\',modified:'',size:null,extension:'pdf'};
/** @type {import('../../netunim-orders/document-bridge/result-registry.mjs').ResultContext} */
const context={query:'document',mode:'content',contentSearch:{matchMode:'phrase',wordMatch:'partial',proximityWords:0}};
const registry=createDocumentResultRegistry({clock:{now:Date.now,ttlMs:10},identity:{next:()=> 'opaque'},files:{stat:async()=>({size:1,mtimeMs:0,mtime:new Date(0),isDirectory:()=>false})}});
/** @type {import('../../netunim-orders/document-bridge/search-owner.mjs').SearchPorts} */
const ports={everything:{search:async()=>({rows:[row],elapsedMs:1}),recent:async()=>({rows:[],elapsedMs:1})},
 pdf:{prepare:async()=>({partial:false}),search:()=>[row]},ordering:{merge:groups=>groups.flat(),compare:()=>0},
 publication:registry,audit:{write:async()=>{}}};
const limits={bridgeVersion:38,maxResults:5000,defaultLimit:150,recentLimit:150};
const search=createDocumentSearch(ports,limits);
/** @type {import('../../netunim-orders/document-bridge/search-owner.mjs').SearchPlan} */
const plan={query:'document',mode:'content',contentSearch:context.contentSearch,fileType:'all',scopePath:'',sort:{field:'modified',direction:'desc'},includePdf:true,everythingQuery:'content:document'};
search.search(plan,2,0);search.recent({fileType:'pdf',scopePath:''},2);
/** @type {Promise<void>} */ const joined=search.dispose();void joined;
// @ts-expect-error raw network data is not a validated search plan
search.search(/** @type {unknown} */({query:'document'}),2,0);
// @ts-expect-error opaque ID generation must be synchronous
createDocumentResultRegistry({clock:{now:Date.now,ttlMs:10},identity:{next:async()=> 'opaque'},files:{stat:async()=>({size:1,mtimeMs:0,mtime:new Date(),isDirectory:()=>false})}});
// @ts-expect-error only a complete public result can be minted synchronously
createDocumentSearch({...ports,publication:{...registry,publish:async()=>registry.publish(row,context)}},limits);
// @ts-expect-error PDF rows cannot be an unjoined deferred read
createDocumentSearch({...ports,pdf:{...ports.pdf,search:async()=>[row]}},limits);
// @ts-expect-error read elapsed time is numeric evidence
createDocumentSearch({...ports,everything:{...ports.everything,search:async()=>({rows:[row],elapsedMs:'17'})}},limits);
// @ts-expect-error result TTL cannot be a formatted timestamp
createDocumentResultRegistry({clock:{now:Date.now,ttlMs:'10 minutes'},identity:{next:()=> 'opaque'},files:{stat:async()=>({size:1,mtimeMs:0,mtime:new Date(),isDirectory:()=>false})}});
// @ts-expect-error search cannot issue arbitrary file commands
search.open(row.fullPath);
// @ts-expect-error private paths are absent from the published result contract
registry.publish(row,context).fullPath;
