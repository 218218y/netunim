import { creditDataDiagnosticFilename } from './credit-data-diagnostics.mjs';
import { bankDiagnosticExportPayload, bankDiagnosticFilename } from './bank-diagnostics.mjs';
export function createDiagnosticQueries({ creditLog, read }) {
    async function creditData() {
        const payload = await read.creditData();
        if (!payload) {
            return { ok: true, available: false, message: 'עדיין אין אבחון נתוני אשראי מקומי. בצע רענון אשראי ולאחריו ייצא את הקובץ.' };
        }
        const cardCount = (Array.isArray(payload.profiles) ? payload.profiles : []).reduce((sum, profile) => sum + (Array.isArray(profile?.accounts) ? profile.accounts.length : 0), 0);
        return {
            ok: true, available: true, generatedAt: payload.generatedAt || null, filename: creditDataDiagnosticFilename(payload), data: payload, cardCount, schemaVersion: Number(payload.schemaVersion) || 1
        };
    }
    async function bank() {
        const diagnostic = await read.bank();
        if (!diagnostic) {
            return { ok: true, available: false, message: 'עדיין אין אבחון בנק מקומי. בצע רענון בנק ולאחריו ייצא את הקובץ.' };
        }
        const payload = bankDiagnosticExportPayload(diagnostic), accounts = payload?.accounts || {};
        const transactionCount = ['business', 'home'].reduce((sum, role) => sum + Number(accounts?.[role]?.captured || 0), 0);
        return {
            ok: true, available: true, generatedAt: payload.finishedAt || payload.startedAt || null, filename: bankDiagnosticFilename(payload), data: payload, transactionCount, schemaVersion: Number(payload.schemaVersion) || 1
        };
    }
    return Object.freeze({ credit: () => creditLog.summary({ limit: 500 }), creditData, bank });
}
