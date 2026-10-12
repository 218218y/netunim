import { parseAccountSelector, normalizeCreditProfileInput, creditProfilesShareLoginIdentity, creditProfilePublic } from './lib.mjs';
export function normalizeStoredCredentials(value) {
    if (!value || typeof value !== 'object')
        return null;
    const legacyAccount = String(value.accountNumber || '').trim(), legacyBranch = String(value.branchNumber || '').trim();
    const legacySelector = legacyBranch ? { bankNumber: '12', branchNumber: legacyBranch.replace(/\D/g, ''), accountNumber: legacyAccount.replace(/\D/g, '') } : parseAccountSelector(legacyAccount);
    const businessBranchNumber = String(value.businessBranchNumber ?? legacySelector.branchNumber ?? '').replace(/\D/g, '');
    const businessAccountNumber = String(value.businessAccountNumber ?? legacySelector.accountNumber ?? '').replace(/\D/g, '');
    const homeBranchNumber = String(value.homeBranchNumber || '').replace(/\D/g, '');
    const homeAccountNumber = String(value.homeAccountNumber || '').replace(/\D/g, '');
    return { ...value, businessBranchNumber, businessAccountNumber, homeBranchNumber, homeAccountNumber, branchNumber: businessBranchNumber, accountNumber: businessAccountNumber };
}
const CONNECTION_IMPORT_SCHEMA = 'netunim-finance-connections';
const CONNECTION_IMPORT_VERSION = 1;
function connectionImportObject(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : null; }
function connectionImportText(value, max = 160) { return String(value ?? '').trim().slice(0, max); }
function connectionImportPlaceholder(value) { return /^(?:\*+|_+fill_me_+|fill[_ -]?me|change[_ -]?me|replace[_ -]?me)$/i.test(connectionImportText(value, 80)); }
function requiredConnectionSecret(value, label) {
    const text = String(value ?? '');
    if (!text.trim() || connectionImportPlaceholder(text)) {
        const error = new Error(`יש למלא בקובץ הייבוא את ${label}`);
        error.code = 'IMPORT_SECRET_PLACEHOLDER';
        throw error;
    }
    return text;
}

function normalizeConnectionImportAccount(value, role) {
    const source = connectionImportObject(value) || {};
    const branchNumber = String(source.branchNumber || '').replace(/\D/g, '');
    const accountNumber = String(source.accountNumber || '').replace(/\D/g, '');
    if ((branchNumber && !accountNumber) || (!branchNumber && accountNumber)) {
        const error = new Error(`לחשבון ${role === 'home' ? 'הביתי' : 'העסקי'} יש להזין גם סניף וגם מספר חשבון`);
        error.code = 'INCOMPLETE_ACCOUNT_SELECTOR';
        error.accountRole = role;
        throw error;
    }
    return { branchNumber, accountNumber };
}
export function normalizeConnectionImportDocument(value) {
    const source = connectionImportObject(value);
    if (!source || source.schema !== CONNECTION_IMPORT_SCHEMA || Number(source.version) !== CONNECTION_IMPORT_VERSION || source.mode !== 'replace') {
        const error = new Error('קובץ הייבוא אינו בפורמט הגדרות החיבור הנתמך');
        error.code = 'INVALID_CONNECTION_IMPORT';
        throw error;
    }
    const bank = connectionImportObject(source.bank);
    if (!bank) {
        const error = new Error('חסרה בקובץ הגדרת בנק');
        error.code = 'INVALID_CONNECTION_IMPORT_BANK';
        throw error;
    }
    if (connectionImportText(bank.provider, 30) !== 'hapoalim') {
        const error = new Error('קובץ הייבוא חייב להגדיר את בנק הפועלים');
        error.code = 'UNSUPPORTED_BANK_PROVIDER';
        throw error;
    }
    const accounts = connectionImportObject(bank.accounts) || {}, business = normalizeConnectionImportAccount(accounts.business, 'business'), home = normalizeConnectionImportAccount(accounts.home, 'home');
    if (business.branchNumber && home.branchNumber && business.branchNumber === home.branchNumber && business.accountNumber === home.accountNumber) {
        const error = new Error('החשבון העסקי והחשבון הביתי חייבים להיות שני חשבונות שונים');
        error.code = 'DUPLICATE_ACCOUNT_ROLE';
        error.accountRole = 'home';
        throw error;
    }
    const credentials = { userCode: requiredConnectionSecret(bank.userCode, 'קוד המשתמש של הבנק'), password: requiredConnectionSecret(bank.password, 'סיסמת הבנק'), businessBranchNumber: business.branchNumber, businessAccountNumber: business.accountNumber, homeBranchNumber: home.branchNumber, homeAccountNumber: home.accountNumber };
    const credit = connectionImportObject(source.credit), rawProfiles = Array.isArray(credit?.profiles) ? credit.profiles : [];
    if (!rawProfiles.length) {
        const error = new Error('חסרות בקובץ הגדרות אשראי');
        error.code = 'INVALID_CONNECTION_IMPORT_CREDIT';
        throw error;
    }
    if (rawProfiles.length > 50) {
        const error = new Error('קובץ הייבוא כולל יותר מדי חיבורי אשראי');
        error.code = 'IMPORT_TOO_MANY_CREDIT_PROFILES';
        throw error;
    }
    const profiles = [], ids = new Set();
    for (const rawValue of rawProfiles) {
        const raw = connectionImportObject(rawValue);
        if (!raw) {
            const error = new Error('אחד מחיבורי האשראי בקובץ אינו תקין');
            error.code = 'INVALID_CONNECTION_IMPORT_CREDIT';
            throw error;
        }
        const nested = connectionImportObject(raw.credentials) || {}, connectionKey = connectionImportText(raw.connectionKey, 64), profileId = connectionImportText(raw.profileId, 80) || (connectionKey ? `import:${connectionKey}` : '');
        if (!profileId) {
            const error = new Error('לכל חיבור אשראי בקובץ נדרש profileId או connectionKey');
            error.code = 'IMPORT_PROFILE_ID_REQUIRED';
            throw error;
        }
        if (ids.has(profileId)) {
            const error = new Error(`מזהה חיבור אשראי כפול בקובץ: ${profileId}`);
            error.code = 'IMPORT_DUPLICATE_PROFILE_ID';
            throw error;
        }
        ids.add(profileId);
        const provider = connectionImportText(raw.provider, 30), flat = { ...raw, ...nested, profileId, provider };
        for (const field of ['username', 'id', 'card6Digits', 'password'])
            if (Object.prototype.hasOwnProperty.call(nested, field))
                flat[field] = nested[field];
        if (provider === 'visaCal' || provider === 'max') {
            flat.username = requiredConnectionSecret(flat.username, `שם המשתמש של ${raw.label || provider}`);
            flat.password = requiredConnectionSecret(flat.password, `הסיסמה של ${raw.label || provider}`);
        }
        else if (provider === 'isracard' || provider === 'amex') {
            flat.id = requiredConnectionSecret(flat.id, `תעודת הזהות של ${raw.label || provider}`);
            flat.card6Digits = requiredConnectionSecret(flat.card6Digits, `6 הספרות של ${raw.label || provider}`);
            flat.password = requiredConnectionSecret(flat.password, `הסיסמה של ${raw.label || provider}`);
        }
        const normalized = normalizeCreditProfileInput(flat, null);
        const duplicate = profiles.find(existing => creditProfilesShareLoginIdentity(existing, normalized));
        if (duplicate) {
            const error = new Error(`בקובץ קיימים שני חיבורים לאותה זהות כניסה בחברה: ${creditProfilePublic(normalized).label}`);
            error.code = 'CREDIT_DUPLICATE_LOGIN';
            throw error;
        }
        profiles.push(normalized);
    }
    return { credentials, profiles };
}
