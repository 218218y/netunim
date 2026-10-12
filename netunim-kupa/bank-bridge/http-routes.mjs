// @ts-check

/**
 * JSON fields remain unknown at HTTP entry. Configuration/provider commands
 * retain their existing validation and normalization; routes cannot read a
 * vault, launch a browser, publish metadata or accept an arbitrary image path.
 * @typedef {Record<string,unknown>} JsonResult
 * @typedef {{bank:Record<string,string>,profiles:readonly unknown[],cleanupWarnings:readonly string[]}} ConnectionImportResult
 * @typedef {{data:Uint8Array,size:number,contentType:string}} ChequeImage
 * @typedef {{response:'json',readBody:boolean,run:(body:unknown)=>Promise<unknown>|unknown,afterResponse?:()=>void} |
 * {response:'binary',readBody:false,run:()=>Promise<ChequeImage|null>}} BankBridgeRoute
 * @typedef {{version:number,contractVersion:number,
 * service:{bankStatus:()=>Promise<JsonResult>,creditStatus:()=>Promise<JsonResult>},
 * connections:{saveCreditProfile:(body:unknown)=>Promise<JsonResult>,deleteCreditProfile:(body:unknown)=>Promise<JsonResult>,
 * resetCreditProfiles:()=>Promise<void>,saveCredentials:(body:unknown)=>Promise<JsonResult>,
 * selectAccount:(body:unknown)=>Promise<JsonResult>,deleteCredentials:()=>Promise<JsonResult>,
 * importConnectionSettings:(body:unknown)=>Promise<ConnectionImportResult>},
 * finance:{balance:(body:unknown)=>Promise<JsonResult>,syncCredit:(body:unknown)=>Promise<JsonResult>},
 * diagnostics:{credit:()=>Promise<unknown[]>,creditData:()=>Promise<JsonResult>,bank:()=>Promise<JsonResult>},
 * cheques:{read:(key:string)=>Promise<ChequeImage|null>},shutdown:{afterResponse:()=>void}}} BankBridgeRoutePorts
 */

/** @param {BankBridgeRoutePorts} ports */
export function createBankBridgeRoutes({version,contractVersion,service,connections,finance,diagnostics,cheques,shutdown}) {
  /** @type {Array<[object,string[]]>} */
  const required = [
    [service,['bankStatus','creditStatus']],
    [connections,['saveCreditProfile','deleteCreditProfile','resetCreditProfiles','saveCredentials','selectAccount','deleteCredentials','importConnectionSettings']],
    [finance,['balance','syncCredit']], [diagnostics,['credit','creditData','bank']],
    [cheques,['read']], [shutdown,['afterResponse']],
  ];
  for (const [capability,names] of required) {
    if (!capability || names.some(name=>typeof Reflect.get(capability,name)!=='function')) {
      throw new Error('bank_bridge_route_ports_required');
    }
  }
  /** @type {Map<string,BankBridgeRoute>} */
  const routes=new Map();
  /** @param {string} key @param {(body:unknown)=>Promise<unknown>|unknown} run @param {boolean} [readBody] */
  const json=(key,run,readBody=false)=>routes.set(key,Object.freeze({response:'json',readBody,run}));
  json('GET /status',async()=>({ok:true,bridgeVersion:version,...await service.bankStatus()}));
  json('GET /credit/status',async()=>({ok:true,bridgeVersion:version,contractVersion,...await service.creditStatus()}));
  json('POST /settings/import',async body=>{
    const imported=await connections.importConnectionSettings(body);
    return {ok:true,bridgeVersion:version,configured:true,bank:imported.bank,credit:{contractVersion,profiles:imported.profiles},cleanupWarnings:imported.cleanupWarnings};
  },true);
  json('GET /credit/diagnostics',async()=>({ok:true,contractVersion,events:await diagnostics.credit()}));
  json('GET /credit/data-diagnostics',()=>diagnostics.creditData());
  json('GET /bank/diagnostics',()=>diagnostics.bank());
  json('POST /credit/profiles',async body=>({ok:true,contractVersion,...await connections.saveCreditProfile(body)}),true);
  json('DELETE /credit/profiles',async body=>({ok:true,contractVersion,...await connections.deleteCreditProfile(body)}),true);
  json('POST /credit/reset',async()=>{await connections.resetCreditProfiles();return {ok:true,profiles:[],lastSyncAt:null,lastErrors:[]}});
  json('POST /credentials',async body=>({ok:true,...await connections.saveCredentials(body)}),true);
  json('POST /account-selection',async body=>({ok:true,...await connections.selectAccount(body)}),true);
  json('DELETE /credentials',async()=>({ok:true,...await connections.deleteCredentials()}));
  json('POST /balance',async body=>({ok:true,...await finance.balance(body)}),true);
  json('POST /credit/sync',async body=>({ok:true,...await finance.syncCredit(body)}),true);
  routes.set('POST /shutdown',Object.freeze({response:'json',readBody:false,run:()=>({ok:true}),afterResponse:()=>shutdown.afterResponse()}));

  /** @param {string|undefined} method @param {string} pathname @returns {BankBridgeRoute|undefined} */
  function resolve(method,pathname) {
    const route=pathname.startsWith('/v2/credit')?pathname.slice(3):pathname;
    const image=method==='GET'?pathname.match(/^\/bank\/cheque-image\/([a-f0-9]{64})$/):null;
    if(image?.[1]) {
      const key=image[1];
      return Object.freeze({response:'binary',readBody:false,run:()=>cheques.read(key)});
    }
    return routes.get(`${method} ${route}`);
  }
  return Object.freeze({resolve});
}
