// Tests execute the actual production HTTP handler in a disposable
// lexical harness. No server, DPAPI process or provider is started by importing it.
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {parse} from 'acorn';
import {timingSafeEqual,randomUUID} from 'node:crypto';
import {createBridgeOperationOwner} from '../netunim-kupa/bank-bridge/operation-owner.mjs';
import {createConnectionCommands,publicCreditProfiles} from '../netunim-kupa/bank-bridge/connection-commands.mjs';
const source=readFileSync(new URL('../netunim-kupa/bank-bridge/server.mjs',import.meta.url),'utf8');
const ast=parse(source,{ecmaVersion:'latest',sourceType:'module'});
const selected=['tokenEqual','corsHeaders','sendJson','readJson','authToken','safeError','handler'];
export function configurationHandler({readProfiles,writeProfiles,resetProfiles,deleteIdentity=async()=>{},...overrides}){
  const declarations=selected.map(name=>{
    const node=ast.body.find(node=>node.type==='FunctionDeclaration'&&node.id.name===name);
    if(!node)throw new Error('missing baseline production declaration: '+name);return source.slice(node.start,node.end);
  });
  const operations=createBridgeOperationOwner();
  const vault={readCreditProfiles:readProfiles,writeCreditProfiles:writeProfiles,deleteCreditProfiles:resetProfiles,
    readCredentials:async()=>({userCode:'fixture',password:'synthetic'}),...overrides.vault};
  const artifacts={clearCreditData:async()=>{},creditIdentity:profile=>profile.profileId,deleteCreditIdentity:deleteIdentity,
    resetCredit:async()=>{},clearImported:async()=>[],clearBank:async()=>{},writeBankMeta:async()=>{},...overrides.artifacts};
  const connections=createConnectionCommands({operations,vault,artifacts});
  const context=vm.createContext({Buffer,URL,timingSafeEqual,randomUUID,console,
    HOST:'127.0.0.1',PORT:8765,BRIDGE_VERSION:73,CREDIT_CONNECTOR_CONTRACT_VERSION:2,MAX_JSON_REQUEST_BYTES:32*1024,
    operations,connections,publicCreditProfiles,vault,readMeta:async()=>({}),
    readCreditMeta:async()=>({lastErrors:[]}),normalizeCreditSyncMode:()=> 'quick',normalizeCreditSyncSelection:()=>[],
    scrapeAllCreditProfiles:async()=>({profiles:[],errors:[],attemptedCount:0}),writeCreditMeta:async()=>{},
    HAPOALIM_INITIAL_BACKFILL_DAYS:365,HAPOALIM_TRANSACTION_LOOKBACK_DAYS:30,
    scrapeHapoalimSnapshot:async()=>({fetchedAt:'fixture',accounts:{}}),writeMeta:async()=>{},...overrides.providerPorts});
  const handler=vm.runInContext(declarations.join('\n')+';handler',context);
  return {handler,operations,connections};
}
export const profile=id=>({profileId:id,provider:'max',label:id,username:id,password:' synthetic password '});
