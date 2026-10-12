import { randomUUID } from 'node:crypto';
import { creditProfilePublic, creditProviderSupported, normalizeCreditProfileInput, creditProfilesShareLoginIdentity } from './lib.mjs';
import { normalizeStoredCredentials, normalizeConnectionImportDocument } from './connection-settings.mjs';
export function publicCreditProfiles(profiles) {
    return (Array.isArray(profiles) ? profiles : []).map(creditProfilePublic).filter(x => x.profileId && creditProviderSupported(x.provider));
}
// Promise.all rejects before the remaining filesystem jobs settle. The owner
// must retain all obligations even when the first cleanup fails.
export async function settleConnectionJobs(jobs) {
    const results = await Promise.allSettled(jobs);
    const failed = results.find(result => result.status === 'rejected');
    if (failed)
        throw failed.reason;
}
// Commands own complete read/modify/write/cleanup obligations. HTTP callers
// receive public projections, never a vault or mutable provider session.
export function createConnectionCommands({ operations, vault, artifacts }) {
    const saveCreditProfile = (body) => operations.configuration(async () => {
        const profiles = await vault.readCreditProfiles(), requestedId = String(body.profileId || '').trim();
        const existing = requestedId ? profiles.find(p => p.profileId === requestedId) : null;
        const normalized = normalizeCreditProfileInput({ ...body, profileId: requestedId || randomUUID() }, existing || null);
        const duplicate = profiles.find(p => p.profileId !== normalized.profileId && creditProfilesShareLoginIdentity(p, normalized));
        if (duplicate)
            throw Object.assign(new Error(`כבר קיים חיבור ${creditProfilePublic(duplicate).label} לאותה זהות בחברה. חיבור אחד מחזיר את כל הכרטיסים של אותה זהות; אין ליצור חיבור נפרד לכל כרטיס.`), { code: 'CREDIT_DUPLICATE_LOGIN' });
        const next = existing ? profiles.map(p => p.profileId === existing.profileId ? normalized : p) : [...profiles, normalized];
        await vault.writeCreditProfiles(next);
        await artifacts.clearCreditData();
        if (existing && artifacts.creditIdentity(existing) !== artifacts.creditIdentity(normalized))
            await artifacts.deleteCreditIdentity(existing);
        return { profile: creditProfilePublic(normalized), profiles: publicCreditProfiles(next) };
    });
    const deleteCreditProfile = (body) => operations.configuration(async () => {
        const profileId = String(body.profileId || '').trim(), profiles = await vault.readCreditProfiles();
        if (!profileId)
            throw Object.assign(new Error('חסר מזהה חיבור אשראי למחיקה'), { code: 'MISSING_PROFILE_ID' });
        const removed = profiles.find(p => p.profileId === profileId), next = profiles.filter(p => p.profileId !== profileId);
        await vault.writeCreditProfiles(next);
        await artifacts.clearCreditData();
        if (removed)
            await artifacts.deleteCreditIdentity(removed);
        return { profiles: publicCreditProfiles(next) };
    });
    const saveCredentials = (body) => operations.configuration(async () => {
        const userCode = String(body.userCode || '').trim(), password = String(body.password || '');
        const businessBranchNumber = String(body.businessBranchNumber ?? body.branchNumber ?? '').replace(/\D/g, ''), businessAccountNumber = String(body.businessAccountNumber ?? body.accountNumber ?? '').replace(/\D/g, '');
        const homeBranchNumber = String(body.homeBranchNumber || '').replace(/\D/g, ''), homeAccountNumber = String(body.homeAccountNumber || '').replace(/\D/g, '');
        if (!userCode || !password)
            throw Object.assign(new Error('חסרים קוד משתמש או סיסמה'), { code: 'MISSING_CREDENTIALS' });
        if ((businessBranchNumber && !businessAccountNumber) || (!businessBranchNumber && businessAccountNumber))
            throw Object.assign(new Error('לחשבון העסקי יש להזין גם סניף וגם מספר חשבון'), { code: 'INCOMPLETE_ACCOUNT_SELECTOR', accountRole: 'business' });
        if ((homeBranchNumber && !homeAccountNumber) || (!homeBranchNumber && homeAccountNumber))
            throw Object.assign(new Error('לחשבון הביתי יש להזין גם סניף וגם מספר חשבון'), { code: 'INCOMPLETE_ACCOUNT_SELECTOR', accountRole: 'home' });
        if (businessBranchNumber && homeBranchNumber && businessBranchNumber === homeBranchNumber && businessAccountNumber === homeAccountNumber)
            throw Object.assign(new Error('החשבון העסקי והחשבון הביתי חייבים להיות שני חשבונות שונים'), { code: 'DUPLICATE_ACCOUNT_ROLE', accountRole: 'home' });
        await vault.writeCredentials({ userCode, password, businessBranchNumber, businessAccountNumber, homeBranchNumber, homeAccountNumber });
        await artifacts.writeBankMeta({ lastError: '', lastErrorAt: null, lastErrorCode: '', lastErrorStage: '', lastErrorHttpStatus: 0, lastWarning: '', lastWarningCode: '', lastWarningStage: '', lastWarningHttpStatus: 0, lastAvailableAccounts: [], lastAccountRole: '' });
        return { configured: true, branchNumber: businessBranchNumber, accountNumber: businessAccountNumber, businessBranchNumber, businessAccountNumber, homeBranchNumber, homeAccountNumber };
    });
    const selectAccount = (body) => operations.configuration(async () => {
        const role = body.role === 'home' ? 'home' : 'business', branchNumber = String(body.branchNumber || '').replace(/\D/g, ''), accountNumber = String(body.accountNumber || '').replace(/\D/g, '');
        if (!branchNumber || !accountNumber)
            throw Object.assign(new Error('יש לבחור גם סניף וגם מספר חשבון'), { code: 'INCOMPLETE_ACCOUNT_SELECTOR', accountRole: role });
        const credentials = await vault.readCredentials();
        if (!credentials)
            throw Object.assign(new Error('לא נשמרו פרטי בנק הפועלים ב-Bank Bridge'), { code: 'NOT_CONFIGURED' });
        const patch = role === 'home' ? { homeBranchNumber: branchNumber, homeAccountNumber: accountNumber } : { businessBranchNumber: branchNumber, businessAccountNumber: accountNumber, branchNumber, accountNumber };
        const next = normalizeStoredCredentials({ ...credentials, ...patch });
        if (next.businessBranchNumber && next.homeBranchNumber && next.businessBranchNumber === next.homeBranchNumber && next.businessAccountNumber === next.homeAccountNumber)
            throw Object.assign(new Error('החשבון העסקי והחשבון הביתי חייבים להיות שני חשבונות שונים'), { code: 'DUPLICATE_ACCOUNT_ROLE', accountRole: role });
        await vault.writeCredentials(next);
        await artifacts.writeBankMeta({ lastError: '', lastErrorAt: null, lastErrorCode: '', lastErrorStage: '', lastErrorHttpStatus: 0, lastWarning: '', lastWarningCode: '', lastWarningStage: '', lastWarningHttpStatus: 0, lastAvailableAccounts: [], lastAccountRole: '' });
        return { configured: true, role, branchNumber, accountNumber, businessBranchNumber: next.businessBranchNumber, businessAccountNumber: next.businessAccountNumber, homeBranchNumber: next.homeBranchNumber, homeAccountNumber: next.homeAccountNumber };
    });
    const deleteCredentials = () => operations.configuration(async () => {
        await settleConnectionJobs([vault.deleteCredentials(), artifacts.clearBank()]);
        await artifacts.writeBankMeta({ lastError: '', lastErrorAt: null, lastErrorCode: '', lastErrorStage: '', lastErrorHttpStatus: 0, lastWarning: '', lastWarningCode: '', lastWarningStage: '', lastWarningHttpStatus: 0, lastAvailableAccounts: [], lastAccountRole: '' });
        return { configured: false };
    });
    const resetCreditProfiles = () => operations.configuration(async () => {
        await settleConnectionJobs([vault.deleteCreditProfiles(), artifacts.resetCredit()]);
    });
    const importConnectionSettings = (body) => operations.configuration(async () => {
        const normalized = normalizeConnectionImportDocument(body);
        await vault.replaceConnections(normalized);
        const cleanupWarnings = await artifacts.clearImported();
        return { ...normalized, cleanupWarnings };
    });
    return Object.freeze({ saveCreditProfile, deleteCreditProfile, resetCreditProfiles, saveCredentials, selectAccount, deleteCredentials, importConnectionSettings });
}
