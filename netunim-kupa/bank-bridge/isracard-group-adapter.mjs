// @ts-nocheck
import { safeError, safeSuffix, text } from './credit-value-codec.mjs';
import { CreditProviderAdapter } from './credit-adapter-base.mjs';
import { creditSyncScope } from './credit-sync-scope.mjs';
import { creditProfilePublic } from './credit-profile-model.mjs';
import { creditThrownScrapeFailure } from './credit-failure-policy.mjs';
import { normalizeCreditScrapeAccount } from './credit-transaction-model.mjs';
import { genericMonthlyAccount } from './credit-monthly-projection.mjs';
import {
  camoufoxCreditSupported,
  isCamoufoxRetryableNativeFailure,
  scrapeIsracardFamilyWithCamoufox,
} from './isracard-camoufox.mjs';
import {
  ISRACARD_DIGITAL_V3_SCHEMA_VERSION,
  scrapeIsracardDigitalV3,
} from './isracard-digitalv3.mjs';
import { AMEX_DIGITAL_V3_SCHEMA_VERSION, scrapeAmexDigitalV3 } from './amex-digitalv3.mjs';

export function attachCamoufoxFallbackContext(fallbackFailure, primaryFailure) {
  if (!fallbackFailure || !primaryFailure) return fallbackFailure;
  const primaryCode = text(primaryFailure?.code, 80),
    primaryStage = text(primaryFailure?.stage, 80),
    primaryStatus = Math.max(0, Math.trunc(Number(primaryFailure?.httpStatus) || 0));
  fallbackFailure.fallbackFromBrowserEngine = 'chromium';
  fallbackFailure.fallbackFromCode = primaryCode;
  fallbackFailure.fallbackFromStage = primaryStage;
  fallbackFailure.fallbackFromHttpStatus = primaryStatus;
  const fallbackStage = text(fallbackFailure?.stage, 80),
    dual403 =
      String(fallbackFailure?.code || '') === 'CREDIT_AUTOMATION_BLOCKED' &&
      Number(fallbackFailure?.httpStatus) === 403 &&
      primaryCode === 'CREDIT_AUTOMATION_BLOCKED' &&
      primaryStatus === 403;
  if (dual403) {
    const primaryWhere = primaryStage ? ` בשלב ${primaryStage}` : '',
      fallbackWhere = fallbackStage ? ` בשלב ${fallbackStage}` : '',
      preCredentials =
        fallbackStage === 'LoginPage' ? ' לפני שליחת פרטי ההתחברות במסלול Camoufox' : '';
    fallbackFailure.message = `שני מסלולי הסנכרון נדחו באותה ריצה: Chrome/Edge קיבל HTTP 403${primaryWhere}, ולאחר מכן Camoufox קיבל HTTP 403${fallbackWhere}${preCredentials}. Camoufox יושהה עד תום ה-cooldown; Chrome/Edge אינו נכנס להשעיית Camoufox ויישאר זכאי לניסיון חדש בריצה הבאה.`;
  }
  return fallbackFailure;
}

class IsracardGroupDigitalV3Adapter extends CreditProviderAdapter {
  constructor(options = {}, schemaVersion = '', scrapeImpl = null) {
    super(options);
    this.connectorVersion = schemaVersion;
    Object.assign(this, {
      browserPath: options.browserPath,
      identityProbeUrl: options.identityProbeUrl || '',
      interactive: !!options.interactive,
      identityDir: options.identityDir,
      allowCamoufoxFallback: options.allowCamoufoxFallback !== false,
      digitalScrapeImpl: scrapeImpl,
    });
  }
  async scrape() {
    const profile = this.profile,
      scope = creditSyncScope({ syncMode: this.syncMode, now: this.now() }),
      started = Date.now();
    try {
      const result = await this.digitalScrapeImpl({
        credentials: profile.credentials,
        browserPath: this.browserPath,
        identityProbeUrl: this.identityProbeUrl,
        interactive: this.interactive,
        startDate: scope.startDate,
        futureMonthsToScrape: scope.futureMonths,
        excludedAccountNumbers: [...this.excludedAccountNumbers],
        onDiagnostic: (event) => this.event({ browserEngine: 'chromium', ...event }),
        now: this.now,
      });
      if (!result?.success)
        throw safeError(
          `${profile.label || profile.provider} DigitalV3 לא השלים את הסנכרון.`,
          'CREDIT_PROVIDER_DATA_ERROR',
          { stage: 'DigitalV3' }
        );
      const syncedAt = this.now().toISOString();
      this.event({
        browserEngine: 'chromium',
        stage: 'Complete',
        durationMs: Date.now() - started,
      });
      const rawAccounts = (Array.isArray(result.accounts) ? result.accounts : []).filter(
          (account) => {
            const accountNumber = text(account?.accountNumber, 80);
            if (!this.excludedAccountNumbers.has(accountNumber)) return true;
            this.event({
              browserEngine: 'chromium',
              stage: 'CardExcluded',
              accountSuffix: safeSuffix(accountNumber),
            });
            return false;
          }
        ),
        dataDiagnostics = (Array.isArray(result?._dataDiagnostics) ? result._dataDiagnostics : [])
          .filter((row) => !this.excludedAccountNumbers.has(text(row?.accountNumber, 80)))
          .map((row) => ({ ...row, profileId: profile.profileId }));
      return {
        ...creditProfilePublic(profile),
        syncedAt,
        attemptedAt: syncedAt,
        coreComplete: true,
        accounts: rawAccounts.map((account) =>
          genericMonthlyAccount(
            account,
            profile.provider,
            { startDate: scope.startDate, futureMonths: scope.futureMonths, now: this.now() },
            this.connectorVersion
          )
        ),
        errors: [],
        _dataDiagnostics: dataDiagnostics,
      };
    } catch (error) {
      const failure = creditThrownScrapeFailure(error, profile);
      if (!failure.browserEngine) failure.browserEngine = 'chromium';
      this.event({
        browserEngine: 'chromium',
        stage: failure?.stage || 'Scrape',
        durationMs: Date.now() - started,
        errorClass: failure?.code,
        httpStatus: failure?.httpStatus,
        providerStatus: failure?.providerStatus,
        providerReturnCode: failure?.providerReturnCode,
      });
      if (
        !this.allowCamoufoxFallback ||
        !isCamoufoxRetryableNativeFailure(failure) ||
        !camoufoxCreditSupported(profile.provider)
      )
        throw failure;
      try {
        return await this.scrapeCamoufox();
      } catch (error) {
        throw attachCamoufoxFallbackContext(creditThrownScrapeFailure(error, profile), failure);
      }
    }
  }
  async scrapeCamoufox() {
    const scope = creditSyncScope({ syncMode: this.syncMode, now: this.now() });
    return camoufoxProfileResult(this, {
      provider: this.profile.provider,
      credentials: this.profile.credentials,
      startDate: scope.startDate,
      futureMonthsToScrape: scope.futureMonths,
      interactive: this.interactive,
      identityDir: this.identityDir,
      excludedAccountNumbers: [...this.excludedAccountNumbers],
      onDiagnostic: (event) => this.event({ browserEngine: 'camoufox', ...event }),
      correlationId: this.correlationId,
      now: this.now,
    });
  }
}

export class IsracardAdapter extends IsracardGroupDigitalV3Adapter {
  constructor(options = {}) {
    super(
      options,
      ISRACARD_DIGITAL_V3_SCHEMA_VERSION,
      options.isracardScrapeImpl || scrapeIsracardDigitalV3
    );
  }
}

export class AmexAdapter extends IsracardGroupDigitalV3Adapter {
  constructor(options = {}) {
    super(options, AMEX_DIGITAL_V3_SCHEMA_VERSION, options.amexScrapeImpl || scrapeAmexDigitalV3);
  }
}

async function camoufoxProfileResult(adapter, options) {
  try {
    const result = await scrapeIsracardFamilyWithCamoufox(options),
      profile = adapter.profile,
      syncedAt = result.coreComplete === false ? null : adapter.now().toISOString(),
      rawAccounts = (Array.isArray(result.accounts) ? result.accounts : []).filter(
        (account) => !adapter.excludedAccountNumbers.has(text(account?.accountNumber, 80))
      ),
      dataDiagnostics = (Array.isArray(result?._dataDiagnostics) ? result._dataDiagnostics : [])
        .filter((row) => !adapter.excludedAccountNumbers.has(text(row?.accountNumber, 80)))
        .map((row) => ({ ...row, profileId: profile.profileId }));
    return {
      ...creditProfilePublic(profile),
      syncedAt,
      attemptedAt: adapter.now().toISOString(),
      coreComplete: result.coreComplete !== false,
      accounts: rawAccounts.map((account) =>
        normalizeCreditScrapeAccount(account, profile.provider)
      ),
      errors: (Array.isArray(result.errors) ? result.errors : []).map((error) => ({
        ...error,
        profileId: profile.profileId,
        provider: profile.provider,
        label: profile.label,
        browserEngine: 'camoufox',
      })),
      _dataDiagnostics: dataDiagnostics,
    };
  } catch (error) {
    const failure = creditThrownScrapeFailure(error, adapter.profile);
    if (!failure.browserEngine) failure.browserEngine = 'camoufox';
    throw failure;
  }
}
