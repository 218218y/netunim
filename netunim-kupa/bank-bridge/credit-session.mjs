// @ts-check
/**
 * @typedef {{profileId:string,provider:string,credentials:Record<string,string>} & Record<string,unknown>} CreditProfile
 * @typedef {{interactive?:boolean,correlationId?:string,syncMode?:string,excludedAccountNumbers?:string[],allowCamoufoxFallback?:boolean}} CreditSessionOptions
 * @typedef {Record<string,unknown>} CreditProfileResult
 * @typedef {{profile:CreditProfile,CompanyTypes:Record<string,unknown>,createScraper:unknown,browserPath:string,identityProbeUrl:string,interactive:boolean,identityDir:string,correlationId:string,syncMode:string,excludedAccountNumbers:string[],allowCamoufoxFallback:boolean,onDiagnostic:(event:Record<string,unknown>)=>unknown}} CreditAdapterOptions
 * @typedef {{browser:{findInstalled:()=>Promise<string>,loadScrapers:()=>Promise<{CompanyTypes:Record<string,unknown>,createScraper:unknown}>,identityProbeUrl:string},identity:{directory:(profile:CreditProfile)=>string},
 * createAdapter:(options:CreditAdapterOptions)=>{scrape:()=>Promise<CreditProfileResult>},diagnostics:{record:(event:Record<string,unknown>)=>unknown}}} CreditSessionPorts
 */
/** @param {CreditSessionPorts} ports */
export function createCreditProfileSession({ browser, identity, createAdapter, diagnostics }) {
    if (typeof browser?.findInstalled !== 'function' || typeof browser?.loadScrapers !== 'function' ||
        typeof identity?.directory !== 'function' || typeof createAdapter !== 'function' || typeof diagnostics?.record !== 'function') {
        throw new Error('credit_session_ports_required');
    }
    const findInstalledBrowser = browser.findInstalled, BROWSER_IDENTITY_PROBE_URL = browser.identityProbeUrl, createCreditProviderAdapter = createAdapter, creditDiagnostics = diagnostics;
    /** @param {CreditProfile} profile @param {CreditSessionOptions} [options] @returns {Promise<CreditProfileResult>} */
    async function scrapeCreditProfile(profile, { interactive = false, correlationId = '', syncMode = 'quick', excludedAccountNumbers = [], allowCamoufoxFallback = true } = {}) {
        const browserPath = await findInstalledBrowser(), { CompanyTypes, createScraper } = await browser.loadScrapers(), identityDir = identity.directory(profile);
        const adapter = createCreditProviderAdapter({
            profile, 
            CompanyTypes, 
            createScraper, 
            browserPath, 
            identityProbeUrl: BROWSER_IDENTITY_PROBE_URL, 
            interactive, 
            identityDir, 
            correlationId, 
            syncMode, 
            excludedAccountNumbers, 
            allowCamoufoxFallback, 
            onDiagnostic: event => creditDiagnostics.record({ browserEngine: 'chromium', ...event })
        });
        return adapter.scrape();
    }
    return Object.freeze({ scrape: scrapeCreditProfile });
}
