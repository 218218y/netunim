import { publicCreditProfiles } from './connection-commands.mjs';
import {bankBridgeErrorResponse, bankBridgeCreditErrors} from './wire-errors.mjs';
export function createConnectionQueries({ operations, vault, metadata }) {
    const bankStatus = () => operations.read(async () => {
        const credentials = await vault.readCredentials(), meta = await metadata.bank();
        const failure = bankBridgeErrorResponse({code:meta.lastErrorCode,stage:meta.lastErrorStage,httpStatus:meta.lastErrorHttpStatus,
            availableAccounts:meta.lastAvailableAccounts,accountRole:meta.lastAccountRole});
        const warning = bankBridgeErrorResponse({code:meta.lastWarningCode || 'PARTIAL',stage:meta.lastWarningStage,httpStatus:meta.lastWarningHttpStatus,
            availableAccounts:meta.lastAvailableAccounts,accountRole:meta.lastAccountRole});
        return {
            configured: !!credentials, branchNumber: credentials?.businessBranchNumber || credentials?.branchNumber || '', accountNumber: credentials?.businessAccountNumber || credentials?.accountNumber || '', businessBranchNumber: credentials?.businessBranchNumber || credentials?.branchNumber || '', businessAccountNumber: credentials?.businessAccountNumber || credentials?.accountNumber || '', homeBranchNumber: credentials?.homeBranchNumber || '', homeAccountNumber: credentials?.homeAccountNumber || '', lastScrapeAt: meta.lastScrapeAt || null,
            lastError: meta.lastError ? failure.message : '', lastErrorAt: meta.lastErrorAt || null,
            lastErrorCode: meta.lastErrorCode ? failure.code : '', lastErrorStage: failure.stage, lastErrorHttpStatus: failure.httpStatus,
            lastWarning: meta.lastWarning ? warning.message : '', lastWarningCode: meta.lastWarningCode ? warning.code : '',
            lastWarningStage: warning.stage, lastWarningHttpStatus: warning.httpStatus,
            accountRole: failure.accountRole, availableAccounts: failure.availableAccounts.length ? failure.availableAccounts : warning.availableAccounts
        };
    });
    const creditStatus = () => operations.read(async () => {
        const profiles = await vault.readCreditProfiles(), meta = await metadata.credit();
        return {
            profiles: publicCreditProfiles(profiles), lastSyncAt: meta.lastSyncAt || null, lastErrors: bankBridgeCreditErrors(meta.lastErrors), lastCorrelationId: meta.lastCorrelationId || null, lastAttemptedCount: Math.max(0, Math.trunc(Number(meta.lastAttemptedCount) || 0)), lastDeferredCount: Math.max(0, Math.trunc(Number(meta.lastDeferredCount) || 0))
        };
    });
    return Object.freeze({ bankStatus, creditStatus });
}
