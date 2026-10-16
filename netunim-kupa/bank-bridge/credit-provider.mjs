import { randomUUID } from 'node:crypto';
import { creditProviderSupported } from './credit-profile-model.mjs';
import {
  creditAutomaticRetryAfterAt,
  deferredCreditProfileError,
  deferredCamoufoxProfileError,
  expiredCamoufoxLoginPageBlock,
  creditErrorSeverity,
  creditErrorComponent,
} from './credit-failure-policy.mjs';
import { CREDIT_CONNECTOR_CONTRACT_VERSION } from './credit-adapter-wire.mjs';
import { normalizeCreditSyncMode } from './credit-sync-scope.mjs';
import { diagnosticFingerprint } from './credit-diagnostic-model.mjs';
// Profiles remain sequential; a session facade owns the connector attempt.
// Identity recovery and diagnostics are explicit ports, not HTTP internals.
export function createCreditProvider({ sessions, identity, diagnostics }) {
    if (typeof sessions?.scrape !== 'function' || typeof identity?.remove !== 'function' || typeof diagnostics?.record !== 'function') {
        throw new Error('credit_provider_ports_required');
    }
    const scrapeCreditProfile = sessions.scrape, creditDiagnostics = diagnostics;
    function excludedAccountsForProfile(selection, profileId) { return selection.find(row => row.profileId === profileId)?.excludedAccounts || []; }
    async function scrapeAllCreditProfiles(profiles, { interactive = false, previousErrors = [], syncMode = 'quick', selection = [] } = {}) {
        const enabled = (Array.isArray(profiles) ? profiles : []).filter(p => p?.active !== false && creditProviderSupported(p?.provider));
        if (!enabled.length)
            throw Object.assign(new Error('לא הוגדרו חיבורי חברות אשראי פעילים'), { code: 'CREDIT_NOT_CONFIGURED' });
        const correlationId = randomUUID(), success = [], errors = [], dataDiagnostics = [];
        let attemptedCount = 0, deferredCount = 0, coreSuccessCount = 0;
        // Deliberately sequential: two identities can use the same issuer, and isolated sequential sessions avoid cross-login cookie races.
        for (const profile of enabled) {
            const deferred = deferredCreditProfileError(previousErrors, profile);
            if (deferred) {
                errors.push(deferred);
                deferredCount++;
                continue;
            }
            const camoufoxDeferred = deferredCamoufoxProfileError(previousErrors, profile);
            const expiredBlockedIdentity = expiredCamoufoxLoginPageBlock(previousErrors, profile);
            attemptedCount++;
            try {
                if (expiredBlockedIdentity) {
                    await identity.remove(profile);
                    await creditDiagnostics.record({ correlationId, 
                        provider: profile.provider, 
                        profileId: profile.profileId, 
                        browserEngine: 'camoufox', 
                        stage: 'IdentityRecovery' });
                }
                const result = await scrapeCreditProfile(profile, {
                    interactive, 
                    correlationId, 
                    syncMode, 
                    excludedAccountNumbers: excludedAccountsForProfile(selection, profile.profileId), 
                    allowCamoufoxFallback: !camoufoxDeferred
                });
                if (Array.isArray(result?._dataDiagnostics))
                    dataDiagnostics.push(...result._dataDiagnostics);
                const { _dataDiagnostics: ignoredDataDiagnostics, ...publicResult } = result || {};
                success.push(publicResult);
                if (publicResult.coreComplete !== false)
                    coreSuccessCount++;
                if (Array.isArray(publicResult.errors))
                    for (const raw of publicResult.errors) {
                        const base = {
                            ...raw, 
                            profileId: raw.profileId || profile.profileId, 
                            provider: raw.provider || profile.provider, 
                            label: raw.label || profile.label, 
                            correlationId,
                            providerRetryAfterAt: raw.providerRetryAfterAt || raw.retryAfterAt || null
                        }, retryAfterAt = creditAutomaticRetryAfterAt(base, Date.now()), severity = creditErrorSeverity(base), component = creditErrorComponent(base), fingerprint = diagnosticFingerprint({ ...base, errorClass: base.code });
                        errors.push({
                            ...base, 
                            severity, 
                            component, 
                            originalFailureAt: base.originalFailureAt || base.at || null, 
                            retryAfterAt: retryAfterAt, 
                            diagnosticFingerprint: fingerprint
                        });
                    }
            }
            catch (error) {
                const at = new Date().toISOString(), browserEngine = ['chromium', 'camoufox'].includes(String(error?.browserEngine || '')) ? String(error.browserEngine) : 'chromium', fallbackFromBrowserEngine = ['chromium', 'camoufox'].includes(String(error?.fallbackFromBrowserEngine || '')) ? String(error.fallbackFromBrowserEngine) : '', base = {
                    profileId: profile.profileId, 
                    provider: profile.provider, 
                    label: profile.label, 
                    code: error?.code || 'CREDIT_SCRAPE_FAILED', 
                    stage: String(error?.stage || '').slice(0, 80), 
                    httpStatus: Number(error?.httpStatus) || 0, 
                    message: error?.message || String(error), 
                    at, 
                    originalFailureAt: at, 
                    retryAfterAt: error?.retryAfterAt || null, 
                    providerRetryAfterAt: error?.providerRetryAfterAt || error?.retryAfterAt || null,
                    correlationId, 
                    browserEngine, 
                    providerStatus: String(error?.providerStatus || '').slice(0, 24), 
                    providerReturnCode: String(error?.providerReturnCode || '').slice(0, 24), 
                    loginStep: ['navigation', 'landing-readiness', 'open-login-popup', 'credentials-submit', 'post-submit-navigation', 'result-detection'].includes(String(error?.loginStep || '')) ? String(error.loginStep) : '', 
                    loginState: ['authenticated-session', 'session-init-only', 'session-auth-only', 'invalid-password-route', 'change-password-route', 'connect-frame', 'dashboard-url', 'no-connect-frame', 'unavailable'].includes(String(error?.loginState || '')) ? String(error.loginState) : '', 
                    fallbackFromBrowserEngine, 
                    fallbackFromCode: String(error?.fallbackFromCode || '').slice(0, 80), 
                    fallbackFromStage: String(error?.fallbackFromStage || '').slice(0, 80), 
                    fallbackFromHttpStatus: Number(error?.fallbackFromHttpStatus) || 0
                }, retryAfterAt = creditAutomaticRetryAfterAt(base, Date.parse(at)), severity = creditErrorSeverity(base), component = creditErrorComponent(base), fingerprint = diagnosticFingerprint({ ...base, errorClass: base.code });
                errors.push({ ...base, severity, component, retryAfterAt: retryAfterAt, diagnosticFingerprint: fingerprint });
                // If Chromium was attempted while a prior Camoufox 403 was still cooling down,
                // retain that engine-scoped not-before record when Chromium also fails. This
                // prevents a second manual refresh from immediately re-entering Camoufox.
                if (camoufoxDeferred && browserEngine !== 'camoufox')
                    errors.push(camoufoxDeferred);
                creditDiagnostics.record({
                    correlationId, 
                    provider: profile.provider, 
                    profileId: profile.profileId, 
                    browserEngine, 
                    syncMode: normalizeCreditSyncMode(syncMode), 
                    stage: base.stage || 'Profile', 
                    errorClass: base.code, 
                    httpStatus: base.httpStatus, 
                    retryAfterAt, 
                    providerRetryAfterAt: base.providerRetryAfterAt,
                    startupFailureReason: error?.startupFailureReason, 
                    providerStatus: base.providerStatus, 
                    providerReturnCode: base.providerReturnCode, 
                    loginStep: base.loginStep, 
                    loginState: base.loginState, 
                    fallbackFromBrowserEngine: base.fallbackFromBrowserEngine, 
                    fallbackFromCode: base.fallbackFromCode, 
                    fallbackFromStage: base.fallbackFromStage, 
                    fallbackFromHttpStatus: base.fallbackFromHttpStatus
                });
            }
        }
        const syncedAt = coreSuccessCount ? new Date().toISOString() : null;
        return {
            contractVersion: CREDIT_CONNECTOR_CONTRACT_VERSION, 
            correlationId, 
            profiles: success, 
            errors, 
            syncedAt, 
            attemptedCount, 
            deferredCount, 
            coreSuccessCount, 
            _dataDiagnostics: dataDiagnostics
        };
    }
    return Object.freeze({ scrape: scrapeAllCreditProfiles });
}
