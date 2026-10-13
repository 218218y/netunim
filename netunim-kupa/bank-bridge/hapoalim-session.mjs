import { HAPOALIM_POST_LOGIN_TIMEOUT_MS, HAPOALIM_NAVIGATION_STABLE_MS, INTERACTIVE_AUTH_TIMEOUT_MS, SILENT_AUTH_TIMEOUT_MS, isTransientNavigationError } from './lib.mjs';
const HAPOALIM_BASE_URL = 'https://login.bankhapoalim.co.il';
// A scoped browser adapter: constructing it starts no polling or navigation.
// Login state belongs to each decorated scraper; readiness timers are awaited
// jobs with an explicit clock, never handles in shared application state.
export function createHapoalimSessionAdapter({ metadata, clock, waitForTerminal }) {
    if (typeof metadata?.read !== 'function' || typeof clock?.now !== 'function' ||
        typeof clock?.delay !== 'function' || typeof waitForTerminal !== 'function') {
        throw new Error('bank_session_ports_required');
    }
    const readMeta = metadata.read, waitForTerminalLoginResult = waitForTerminal;
    async function readHapoalimSessionState(page) {
        return page.evaluate(async () => {
            const href = String(window.location.href || '');
            const restContext = String(window.bnhpApp?.restContext || '').replace(/^\/+/, '');
            if (!restContext)
                return { ready: false, href, restContext, status: 0, message: 'bank app context is not ready' };
            try {
                const response = await fetch(`${window.location.origin}/ServerServices/general/accounts`, { credentials: 'include', cache: 'no-store' });
                const text = await response.text();
                let accounts = [];
                try {
                    accounts = text ? JSON.parse(text) : [];
                }
                catch { }
                return {
                    ready: response.ok && Array.isArray(accounts), 
                    href, 
                    restContext, 
                    status: response.status, 
                    accounts, 
                    message: response.ok ? '' : text.slice(0, 240)
                };
            }
            catch (error) {
                return { ready: false, href, restContext, status: 0, message: String(error?.message || error) };
            }
        });
    }
    async function hapoalimSessionIsAuthenticated(page) {
        try {
            return !!(await readHapoalimSessionState(page))?.ready;
        }
        catch {
            return false;
        }
    }
    function scraperLoginResultFromTerminal(resultKey, successKey) {
        const key = String(resultKey || '').toUpperCase(), success = String(successKey || 'SUCCESS').toUpperCase();
        if (key === success)
            return { success: true };
        const failureKey = key || 'GENERAL';
        return { success: false, errorType: failureKey, errorMessage: `Login failed with ${failureKey} error` };
    }
    function enableHapoalimSessionAwareLogin(scraper, { interactive = false } = {}) {
        const originalGetLoginOptions = scraper?.getLoginOptions?.bind(scraper), originalLogin = scraper?.login?.bind(scraper);
        if (typeof originalGetLoginOptions !== 'function' || typeof originalLogin !== 'function')
            throw Object.assign(new Error('גרסת scraper של הפועלים אינה תואמת למתאם ההתחברות'), { code: 'SCRAPER_ADAPTER_INCOMPATIBLE' });
        let activeLogin = null;
        scraper.getLoginOptions = (credentials) => {
            const options = originalGetLoginOptions(credentials), originalResults = options.possibleResults || {};
            const successKey = Object.keys(originalResults).find(key => String(key).toUpperCase() === 'SUCCESS') || 'SUCCESS';
            const originalSuccess = Array.isArray(originalResults[successKey]) ? originalResults[successKey] : [originalResults[successKey]].filter(Boolean);
            const detectionResults = { ...originalResults, [successKey]: [...originalSuccess, async () => hapoalimSessionIsAuthenticated(scraper.page)] };
            const state = { successKey, detectionResults, terminalResultKey: '' };
            activeLogin = state;
            const possibleResults = Object.fromEntries(Object.entries(originalResults).map(([key, conditions]) => [key, [...(Array.isArray(conditions) ? conditions : [conditions]), async () => state.terminalResultKey === key]]));
            if (!possibleResults[successKey])
                possibleResults[successKey] = [async () => state.terminalResultKey === successKey];
            const timeoutMs = interactive ? INTERACTIVE_AUTH_TIMEOUT_MS : SILENT_AUTH_TIMEOUT_MS;
            return {
                ...options, possibleResults, postAction: async () => {
                    const terminal = await waitForTerminalLoginResult(scraper.page, detectionResults, {
                        timeoutMs, 
                        pollMs: 500,
                        timeoutCode: interactive ? 'INTERACTIVE_AUTH_TIMEOUT' : 'SILENT_AUTH_TIMEOUT',
                        timeoutMarker: interactive ? 'NETUNIM_INTERACTIVE_AUTH_TIMEOUT' : 'NETUNIM_SILENT_AUTH_TIMEOUT',
                        closedCode: interactive ? 'INTERACTIVE_BROWSER_CLOSED' : 'BANK_PAGE_CLOSED',
                        closedMarker: interactive ? 'NETUNIM_INTERACTIVE_BROWSER_CLOSED' : 'NETUNIM_BANK_PAGE_CLOSED',
                    });
                    state.terminalResultKey = terminal.resultKey;
                }
            };
        };
        scraper.login = async (credentials) => {
            try {
                return await originalLogin(credentials);
            }
            catch (error) {
                if (!isTransientNavigationError(error) || !activeLogin)
                    throw error;
                let resultKey = activeLogin.terminalResultKey;
                if (!resultKey) {
                    const timeoutMs = interactive ? INTERACTIVE_AUTH_TIMEOUT_MS : SILENT_AUTH_TIMEOUT_MS;
                    const terminal = await waitForTerminalLoginResult(scraper.page, activeLogin.detectionResults, {
                        timeoutMs, 
                        pollMs: 350,
                        timeoutCode: interactive ? 'INTERACTIVE_AUTH_TIMEOUT' : 'SILENT_AUTH_TIMEOUT',
                        timeoutMarker: interactive ? 'NETUNIM_INTERACTIVE_AUTH_TIMEOUT' : 'NETUNIM_SILENT_AUTH_TIMEOUT',
                        closedCode: interactive ? 'INTERACTIVE_BROWSER_CLOSED' : 'BANK_PAGE_CLOSED',
                        closedMarker: interactive ? 'NETUNIM_INTERACTIVE_BROWSER_CLOSED' : 'NETUNIM_BANK_PAGE_CLOSED',
                    });
                    resultKey = terminal.resultKey;
                    activeLogin.terminalResultKey = resultKey;
                }
                return scraperLoginResultFromTerminal(resultKey, activeLogin.successKey);
            }
        };
        return scraper;
    }
    async function waitForHapoalimSessionReady(page, { timeoutMs = HAPOALIM_POST_LOGIN_TIMEOUT_MS, pollMs = 350, stableMs = HAPOALIM_NAVIGATION_STABLE_MS } = {}) {
        const deadline = clock.now() + Math.max(1000, Number(timeoutMs) || HAPOALIM_POST_LOGIN_TIMEOUT_MS);
        let last = { href: '', restContext: '', status: 0, message: '' }, stableKey = '', stableSince = 0;
        while (clock.now() < deadline) {
            if (page?.isClosed?.())
                throw Object.assign(new Error('חלון הבנק נסגר לפני שניתן היה לקרוא את נתוני החשבון'), { code: 'BANK_PAGE_CLOSED' });
            try {
                last = await readHapoalimSessionState(page);
                if (last?.ready) {
                    const key = `${String(last.href || '')}|${String(last.restContext || '')}`;
                    if (key !== stableKey) {
                        stableKey = key;
                        stableSince = clock.now();
                    }
                    if (clock.now() - stableSince >= Math.max(0, Number(stableMs) || 0))
                        return last;
                }
                else {
                    stableKey = '';
                    stableSince = 0;
                }
            }
            catch (e) {
                if (!isTransientNavigationError(e))
                    last = { ...last, message: String(e?.message || e) };
                stableKey = '';
                stableSince = 0;
            }
            await clock.delay(Math.min(pollMs, Math.max(50, deadline - clock.now())));
        }
        const status = last?.status ? ` HTTP ${last.status}` : '';
        const e = new Error(`הכניסה לבנק הצליחה, אבל שירות הנתונים של הפועלים לא נשאר יציב מספיק לקריאת נתונים בתוך ${Math.round(timeoutMs / 1000)} שניות.${status}`);
        e.code = 'BANK_SESSION_NOT_READY';
        e.detail = last;
        throw e;
    }
    function safeHapoalimSessionUrl(value) {
        try {
            const url = new URL(String(value || ''));
            return url.origin === HAPOALIM_BASE_URL ? `${url.origin}${url.pathname}` : '';
        }
        catch {
            return '';
        }
    }
    async function tryReuseSavedHapoalimSession(page) {
        const sessionUrl = safeHapoalimSessionUrl((await readMeta()).sessionUrl);
        if (!sessionUrl)
            return null;
        try {
            await page.goto(sessionUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            return await waitForHapoalimSessionReady(page, { timeoutMs: 8000, pollMs: 400 });
        }
        catch {
            return null;
        }
    }
    return Object.freeze({
        decorate: enableHapoalimSessionAwareLogin, 
        ready: waitForHapoalimSessionReady, 
        reuse: tryReuseSavedHapoalimSession, 
        safeUrl: safeHapoalimSessionUrl
    });
}
