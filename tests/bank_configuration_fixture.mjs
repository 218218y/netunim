// Actual inert capability composition, with controlled vault/provider ports.
// Importing this fixture never starts a server, DPAPI process or live provider.
import {createBridgeOperationOwner} from '../netunim-kupa/bank-bridge/operation-owner.mjs';
import {createConnectionCommands} from '../netunim-kupa/bank-bridge/connection-commands.mjs';
import {createConnectionQueries} from '../netunim-kupa/bank-bridge/connection-queries.mjs';
import {createFinanceCommands} from '../netunim-kupa/bank-bridge/finance-commands.mjs';
import {createDiagnosticQueries} from '../netunim-kupa/bank-bridge/diagnostic-queries.mjs';
import {createBankBridgeRoutes} from '../netunim-kupa/bank-bridge/http-routes.mjs';
import {createBankBridgeHttpHandler} from '../netunim-kupa/bank-bridge/http-handler.mjs';
export function configurationHandler({readProfiles=async()=>[],writeProfiles=async()=>{},resetProfiles=async()=>{},deleteIdentity=async()=>{},...overrides}={}){
  const operations=createBridgeOperationOwner();
  const vault={readCreditProfiles:readProfiles,writeCreditProfiles:writeProfiles,deleteCreditProfiles:resetProfiles,
    readCredentials:async()=>({userCode:'fixture',password:'synthetic'}),...overrides.vault};
  const artifacts={clearCreditData:async()=>{},creditIdentity:profile=>profile.profileId,deleteCreditIdentity:deleteIdentity,
    resetCredit:async()=>{},clearImported:async()=>[],clearBank:async()=>{},writeBankMeta:async()=>{},...overrides.artifacts};
  const connections=createConnectionCommands({operations,vault,artifacts});
  const ports={readMeta:async()=>({}),
    creditDiagnostics:{summary:async()=>[]},readCreditDataDiagnostic:async()=>null,readBankDiagnostic:async()=>null,
    readCachedChequeImage:async()=>null,chequeImageInRetention:()=>true,
    readCreditMeta:async()=>({lastErrors:[]}),
    scrapeAllCreditProfiles:async()=>({profiles:[],errors:[],attemptedCount:0}),writeCreditMeta:async()=>{},writeCreditDataDiagnostic:async()=>{},
    scrapeHapoalimSnapshot:async()=>({fetchedAt:'fixture',accounts:{}}),writeMeta:async()=>{},...overrides.providerPorts};
  const service=createConnectionQueries({operations,vault,metadata:{bank:ports.readMeta,credit:ports.readCreditMeta}});
  const finance=createFinanceCommands({operations,bank:{readCredentials:vault.readCredentials,scrape:ports.scrapeHapoalimSnapshot,writeMeta:ports.writeMeta},
    credit:{readProfiles:vault.readCreditProfiles,readMeta:ports.readCreditMeta,scrape:ports.scrapeAllCreditProfiles,writeMeta:ports.writeCreditMeta,writeDataDiagnostic:ports.writeCreditDataDiagnostic}});
  const diagnostics=createDiagnosticQueries({creditLog:ports.creditDiagnostics,read:{creditData:ports.readCreditDataDiagnostic,bank:ports.readBankDiagnostic}});
  const routes=createBankBridgeRoutes({version:73,contractVersion:2,service,connections,finance,diagnostics,
    cheques:{read:async key=>{const image=await ports.readCachedChequeImage(key);return image&&ports.chequeImageInRetention(image.eventDate)?image:null}},
    shutdown:{afterResponse:overrides.afterResponse||(()=>{})}});
  const handler=createBankBridgeHttpHandler({token:'fixture-token',routes,health:()=>({ok:true,service:'netunim-kupa-bank-bridge',version:73,creditContractVersion:2})});
  return {handler,operations,connections,finance,service,diagnostics,ports};
}
export const profile=id=>({profileId:id,provider:'max',label:id,username:id,password:' synthetic password '});
