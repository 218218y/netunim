import {buildEsCountArgs,buildEsPdfInventoryArgs,parseEsCount,parseEsJson} from './lib.mjs';

export function createEverythingInventorySource({loadConfig, probeEverything, runEs}) {
  const assertActive = signal => { if (signal?.aborted) throw Object.assign(new Error('PDF inventory interrupted'), {name: 'AbortError', code: 'ABORT_ERR'}); };
  return {async open(signal) {
    assertActive(signal); const config = await loadConfig(); assertActive(signal);
    const source = await probeEverything({autoStart:true}); assertActive(signal);
    const {esPath,instance=''}=source,timeoutMs=config.searchTimeoutMs;
    if(typeof esPath!=='string'||!esPath||typeof instance!=='string'||!Number.isFinite(timeoutMs)||timeoutMs<3000||timeoutMs>30000)throw new Error('pdf_inventory_source_required');
    // Capture scalars once. Other searches can refresh the process/config cache;
    // an inventory never combines pages/counts from different IPC instances.
    return {
      async count(signal) {
        assertActive(signal);const {stdout}=await runEs(esPath,buildEsCountArgs({search:'ext:pdf',timeoutMs,instance,filesOnly:true}),{timeout:timeoutMs+3000,signal});
        assertActive(signal);return parseEsCount(stdout);
      },
      async page({offset,limit,modifiedSince,signal}) {
        assertActive(signal);const args=buildEsPdfInventoryArgs({limit,offset,timeoutMs,instance,modifiedSince}),options={timeout:timeoutMs+5000,signal};let output;
        try{output=await runEs(esPath,args,options)}catch(error){
          if(error?.exitCode!==8)throw error;
          assertActive(signal);const fresh=await probeEverything({fresh:true,autoStart:true});assertActive(signal);
          if(fresh.esPath!==esPath||(fresh.instance||'')!==instance)throw Object.assign(new Error('PDF inventory IPC source changed; restart reconciliation'),{code:'PDF_INVENTORY_SOURCE_CHANGED',cause:error});
          output=await runEs(esPath,args,options);
        }
        const {stdout}=output;
        assertActive(signal);return parseEsJson(stdout);
      },
    };
  }};
}
