import { publicCreditProfiles } from './connection-commands.mjs';
export function createConnectionQueries({ operations, vault, metadata }) {
    const bankStatus = () => operations.read(async () => {
        const credentials = await vault.readCredentials(), meta = await metadata.bank();
        return {
            configured: !!credentials, branchNumber: credentials?.businessBranchNumber || credentials?.branchNumber || '', accountNumber: credentials?.businessAccountNumber || credentials?.accountNumber || '', businessBranchNumber: credentials?.businessBranchNumber || credentials?.branchNumber || '', businessAccountNumber: credentials?.businessAccountNumber || credentials?.accountNumber || '', homeBranchNumber: credentials?.homeBranchNumber || '', homeAccountNumber: credentials?.homeAccountNumber || '', lastScrapeAt: meta.lastScrapeAt || null, lastError: meta.lastError || '', lastErrorAt: meta.lastErrorAt || null, lastErrorCode: meta.lastErrorCode || '', lastErrorStage: meta.lastErrorStage || '', lastErrorHttpStatus: Number(meta.lastErrorHttpStatus) || 0, lastWarning: meta.lastWarning || '', lastWarningCode: meta.lastWarningCode || '', lastWarningStage: meta.lastWarningStage || '', lastWarningHttpStatus: Number(meta.lastWarningHttpStatus) || 0, accountRole: meta.lastAccountRole === 'home' ? 'home' : meta.lastAccountRole === 'business' ? 'business' : '', availableAccounts: Array.isArray(meta.lastAvailableAccounts) ? meta.lastAvailableAccounts : []
        };
    });
    const creditStatus = () => operations.read(async () => {
        const profiles = await vault.readCreditProfiles(), meta = await metadata.credit();
        return {
            profiles: publicCreditProfiles(profiles), lastSyncAt: meta.lastSyncAt || null, lastErrors: Array.isArray(meta.lastErrors) ? meta.lastErrors : [], lastCorrelationId: meta.lastCorrelationId || null, lastAttemptedCount: Math.max(0, Math.trunc(Number(meta.lastAttemptedCount) || 0)), lastDeferredCount: Math.max(0, Math.trunc(Number(meta.lastDeferredCount) || 0))
        };
    });
    return Object.freeze({ bankStatus, creditStatus });
}
