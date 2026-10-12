import { HAPOALIM_INITIAL_BACKFILL_DAYS, HAPOALIM_TRANSACTION_LOOKBACK_DAYS } from './lib.mjs';
import { normalizeCreditSyncMode } from './credit-adapters.mjs';
import { buildCreditDataDiagnosticPayload } from './credit-data-diagnostics.mjs';
function normalizeCreditSyncSelection(value) { return (Array.isArray(value) ? value : []).slice(0, 100).map(row => ({ profileId: String(row?.profileId || '').trim().slice(0, 80), excludedAccounts: [...new Set((Array.isArray(row?.excludedAccounts) ? row.excludedAccounts : []).slice(0, 100).map(account => String(account || '').trim().slice(0, 80)).filter(Boolean))] })).filter(row => row.profileId && row.excludedAccounts.length); }
// Provider ownership includes vault reads and diagnostic/status publication.
// HTTP sees only completed public results, never provider or vault internals.
export function createFinanceCommands({ operations, bank, credit }) {
    const syncCredit = body => operations.provider(async () => {
        const profiles = await credit.readProfiles(), meta = await credit.readMeta(), syncMode = normalizeCreditSyncMode(body.syncMode), selection = normalizeCreditSyncSelection(body.selection);
        const result = await credit.scrape(profiles, {
            interactive: !!body.interactive, previousErrors: meta.lastErrors, syncMode, selection
        }), rawSamples = Array.isArray(result?._dataDiagnostics) ? result._dataDiagnostics : [], publicResult = { ...result };
        delete publicResult._dataDiagnostics;
        if (publicResult.profiles.length)
            await credit.writeDataDiagnostic(buildCreditDataDiagnosticPayload({ correlationId: publicResult.correlationId, profiles: publicResult.profiles, rawSamples }));
        await credit.writeMeta({
            ...(publicResult.syncedAt ? { lastSyncAt: publicResult.syncedAt } : {}), lastErrors: publicResult.errors, lastCorrelationId: publicResult.correlationId, lastAttemptedCount: publicResult.attemptedCount, lastDeferredCount: publicResult.deferredCount
        });
        if (!publicResult.profiles.length && publicResult.errors.length && publicResult.attemptedCount > 0) {
            const e = new Error(publicResult.errors.map(x => x.message).join(' | '));
            e.code = 'CREDIT_SYNC_FAILED';
            e.creditErrors = publicResult.errors;
            throw e;
        }
        return publicResult;
    });
    const balance = body => operations.provider(async () => {
        const credentials = await bank.readCredentials();
        if (!credentials)
            throw Object.assign(new Error('לא נשמרו פרטי בנק הפועלים ב-Bank Bridge'), { code: 'NOT_CONFIGURED' });
        try {
            const historyDays = Math.min(HAPOALIM_INITIAL_BACKFILL_DAYS, Math.max(HAPOALIM_TRANSACTION_LOOKBACK_DAYS, Number(body.historyDays) || HAPOALIM_TRANSACTION_LOOKBACK_DAYS));
            const result = await bank.scrape(credentials, { interactive: !!body.interactive, historyDays });
            const homeFailure = result.accountFailures?.home || null;
            const warnings = [result.accounts?.business?.transactionWarning ? `עסקי: ${result.accounts.business.transactionWarning}` : '', result.accounts?.home?.transactionWarning ? `ביתי: ${result.accounts.home.transactionWarning}` : '', homeFailure?.message ? `ביתי: ${homeFailure.message}` : ''].filter(Boolean).join(' | ');
            await bank.writeMeta({
                lastScrapeAt: result.fetchedAt, lastError: '', lastErrorAt: null, lastErrorCode: '', lastErrorStage: '', lastErrorHttpStatus: 0, lastWarning: warnings, lastWarningCode: homeFailure?.code || '', lastWarningStage: homeFailure?.stage || '', lastWarningHttpStatus: Number(homeFailure?.httpStatus) || 0, lastAvailableAccounts: Array.isArray(homeFailure?.availableAccounts) ? homeFailure.availableAccounts : [], lastAccountRole: homeFailure ? 'home' : ''
            });
            return result;
        }
        catch (e) {
            await bank.writeMeta({
                lastError: e?.message || String(e), lastErrorAt: new Date().toISOString(), lastErrorCode: e?.code || 'BRIDGE_ERROR', lastErrorStage: e?.stage || '', lastErrorHttpStatus: Number(e?.httpStatus) || 0, lastWarning: '', lastWarningCode: '', lastWarningStage: '', lastWarningHttpStatus: 0, lastAvailableAccounts: Array.isArray(e?.availableAccounts) ? e.availableAccounts : [], lastAccountRole: e?.accountRole === 'home' ? 'home' : e?.accountRole === 'business' ? 'business' : ''
            });
            throw e;
        }
    });
    return Object.freeze({ balance, syncCredit });
}
