// @ts-check
import { runStage, stageError } from './provider-errors.mjs';
/**
 * @typedef {{userCode:string,password:string} & Record<string,unknown>} BankCredentials
 * @typedef {{ready:true,href:string,restContext:string} & Record<string,unknown>} BankReady
 * @typedef {{page:unknown,initialize:()=>Promise<void>,login:(credentials:{userCode:string,password:string})=>Promise<{success?:boolean,errorType?:unknown,errorMessage?:unknown}>,terminate:(success:boolean)=>Promise<unknown>}} BankScraper
 * @typedef {{companyId:string,startDate:Date,combineInstallments:boolean,showBrowser:boolean,executablePath:string,args:string[],navigationRetryCount:number,defaultTimeout:number}} BankScraperOptions
 * @typedef {{accounts?:Record<string,{captured?:unknown}>} & Record<string,unknown>} BankDiagnostic
 * @typedef {Record<string,unknown> & {sessionHref?:string}} BankSnapshot
 * @typedef {{browser:{findInstalled:()=>Promise<string>,ensureProfile:()=>Promise<void>,profileDirectory:string,loadScrapers:()=>Promise<{CompanyTypes:{hapoalim:string},createScraper:(options:BankScraperOptions)=>BankScraper}>},
 * session:{decorate:(scraper:BankScraper,options:{interactive:boolean})=>unknown,reuse:(page:unknown)=>Promise<BankReady|null>,ready:(page:unknown)=>Promise<BankReady>,safeUrl:(value:unknown)=>string,failureMessage:(result:unknown)=>[string,string]},
 * accounts:{lookbackDays:number,read:(page:unknown,credentials:BankCredentials,ready:BankReady,historyDays:number,options:{diagnosticRun:BankDiagnostic})=>Promise<BankSnapshot>},
 * diagnostics:{create:(options:{bridgeVersion:number})=>BankDiagnostic,finish:(run:BankDiagnostic,options:{failure:unknown})=>unknown,write:(run:BankDiagnostic)=>Promise<void>,report:(label:string,error:unknown)=>void},
 * cache:{cleanup:()=>Promise<void>},metadata:{write:(patch:{sessionUrl:string})=>Promise<void>},version:number}} HapoalimProviderPorts
 */
/** @param {HapoalimProviderPorts} ports */
export function createHapoalimProvider({ browser, session, accounts, diagnostics, cache, metadata, version }) {
    /** @type {Array<[object,string[]]>} */
    const required = [
        [browser, ['findInstalled', 'ensureProfile', 'loadScrapers']],
        [session, ['decorate', 'reuse', 'ready', 'safeUrl', 'failureMessage']],
        [accounts, ['read']], [diagnostics, ['create', 'finish', 'write', 'report']],
        [cache, ['cleanup']], [metadata, ['write']],
    ];
    for (const [capability, methods] of required) {
        if (!capability || methods.some(method => typeof Reflect.get(capability, method) !== 'function')) {
            throw new Error('bank_provider_ports_required');
        }
    }
    const findInstalledBrowser = browser.findInstalled, BROWSER_PROFILE_DIR = browser.profileDirectory, BRIDGE_VERSION = version;
    const { decorate: enableHapoalimSessionAwareLogin, reuse: tryReuseSavedHapoalimSession, ready: waitForHapoalimSessionReady, safeUrl: safeHapoalimSessionUrl, failureMessage: scraperFailureMessage } = session;
    const fetchSelectedHapoalimSnapshot = accounts.read, HAPOALIM_TRANSACTION_LOOKBACK_DAYS = accounts.lookbackDays;
    const { create: createBankDiagnosticRun, finish: finishBankDiagnosticRun, write: writeBankDiagnostic } = diagnostics;
    const cleanupChequeImageCache = cache.cleanup, writeMeta = metadata.write;
    /** @param {BankCredentials} credentials @param {{interactive?:boolean,historyDays?:number}} [options] @returns {Promise<Record<string,unknown>>} */
    async function scrapeHapoalimSnapshot(credentials, { interactive = false, historyDays = HAPOALIM_TRANSACTION_LOOKBACK_DAYS } = {}) {
        let scraper = /** @type {BankScraper|null} */ (null), success = false, failure = /** @type {unknown} */ (null);
        const diagnosticRun = createBankDiagnosticRun({ bridgeVersion: BRIDGE_VERSION });
        try {
            try {
                await cleanupChequeImageCache();
            }
            catch (error) {
                diagnostics.report('Bank Bridge cheque image cache cleanup failed:', error);
            }
            const browserPath = await runStage('browser', () => findInstalledBrowser(), 'BROWSER_NOT_FOUND');
            await browser.ensureProfile();
            const { CompanyTypes, createScraper } = await browser.loadScrapers();
            scraper = createScraper({
                companyId: CompanyTypes.hapoalim,
                startDate: new Date(),
                combineInstallments: false,
                showBrowser: !!interactive,
                executablePath: browserPath,
                args: [`--user-data-dir=${BROWSER_PROFILE_DIR}`, '--profile-directory=Default', '--no-first-run', '--no-default-browser-check'],
                navigationRetryCount: 1,
                defaultTimeout: 30000,
            });
            enableHapoalimSessionAwareLogin(scraper, { interactive });
            // These awaited callbacks execute after allocation; the nullable outer
            // slot also owns cleanup when allocation or initialization fails.
            await runStage('browser', () => ( /** @type {BankScraper} */(scraper)).initialize(), 'BROWSER_START_FAILED');
            let ready = await tryReuseSavedHapoalimSession(scraper.page);
            if (!ready) {
                let loginResult;
                try {
                    loginResult = await scraper.login({ userCode: credentials.userCode, password: credentials.password });
                }
                catch (e) {
                    const [message, code] = scraperFailureMessage({ errorType: 'GENERIC', errorMessage: ( /** @type {{message?:unknown}|null|undefined} */(e))?.message || String(e) });
                    throw stageError('login', Object.assign(new Error(message), { code }));
                }
                if (!loginResult?.success) {
                    const [message, code] = scraperFailureMessage(loginResult);
                    throw stageError('login', Object.assign(new Error(message), { code }));
                }
                ready = await runStage('session', () => waitForHapoalimSessionReady(( /** @type {BankScraper} */(scraper)).page), 'BANK_SESSION_NOT_READY');
            }
            const snapshot = await runStage('data', () => fetchSelectedHapoalimSnapshot(( /** @type {BankScraper} */(scraper)).page, credentials, ready, historyDays, { diagnosticRun }), 'BANK_DATA_ERROR');
            const sessionUrl = safeHapoalimSessionUrl(snapshot?.sessionHref || ready?.href);
            if (sessionUrl)
                await writeMeta({ sessionUrl });
            success = true;
            const { sessionHref: _, ...publicSnapshot } = snapshot;
            return { ...publicSnapshot, fetchedAt: new Date().toISOString() };
        }
        catch (error) {
            failure = error;
            throw error;
        }
        finally {
            try {
                finishBankDiagnosticRun(diagnosticRun, { failure });
                const captured = ['business', 'home'].some(role => Number(diagnosticRun.accounts?.[role]?.captured) > 0);
                if (success || captured)
                    await writeBankDiagnostic(diagnosticRun);
            }
            catch (error) {
                diagnostics.report('Bank Bridge diagnostic write failed:', error);
            }
            if (scraper) {
                try {
                    await scraper.terminate(success);
                }
                catch (e) {
                    diagnostics.report('Bank Bridge browser cleanup failed:', e);
                }
            }
        }
    }
    return Object.freeze({ read: scrapeHapoalimSnapshot });
}
