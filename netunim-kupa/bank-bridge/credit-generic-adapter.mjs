// @ts-nocheck
import { CreditProviderAdapter } from './credit-adapter-base.mjs';
import { creditSyncScope } from './credit-sync-scope.mjs';
import { creditProfilePublic } from './credit-profile-model.mjs';
import { creditScrapeFailure, creditThrownScrapeFailure } from './credit-failure-policy.mjs';
import { safeSuffix, text } from './credit-value-codec.mjs';
import { maxRawDiagnosticSamples } from './max-model.mjs';
import { genericMonthlyAccount } from './credit-monthly-projection.mjs';

export class GenericScraperAdapter extends CreditProviderAdapter {
  constructor(options = {}) {
    super(options);
    Object.assign(this, {
      createScraper: options.createScraper,
      CompanyTypes: options.CompanyTypes,
      companyId: options.companyId,
      browserPath: options.browserPath,
      interactive: !!options.interactive,
      preparePage: options.preparePage,
    });
  }
  async scrape() {
    const profile = this.profile,
      scope = creditSyncScope({ syncMode: this.syncMode, now: this.now() }),
      startDate = scope.startDate,
      scraper = this.createScraper({
        companyId: this.companyId,
        startDate,
        futureMonthsToScrape: scope.futureMonths,
        combineInstallments: false,
        showBrowser: this.interactive,
        executablePath: this.browserPath,
        navigationRetryCount: 1,
        defaultTimeout: 45_000,
        timeout: 90_000,
        additionalTransactionInformation: false,
        includeRawTransaction: this.profile?.provider === 'max',
        outputData: { enableTransactionsFilterByDate: false },
        ...(this.preparePage ? { preparePage: this.preparePage } : {}),
      }),
      started = Date.now();
    try {
      const result = await scraper.scrape(profile.credentials);
      if (!result?.success) throw creditScrapeFailure(result, profile);
      const syncedAt = this.now().toISOString(),
        rawAccounts = Array.isArray(result.accounts) ? result.accounts : [],
        includedAccounts = rawAccounts.filter((account) => {
          const accountNumber = text(account?.accountNumber, 80);
          if (!this.excludedAccountNumbers.has(accountNumber)) return true;
          this.event({
            browserEngine: 'chromium',
            stage: 'CardExcluded',
            accountSuffix: safeSuffix(accountNumber),
          });
          return false;
        }),
        dataDiagnostics =
          profile.provider === 'max'
            ? maxRawDiagnosticSamples(includedAccounts, profile.profileId)
            : [];
      this.event({
        browserEngine: 'chromium',
        stage: 'Complete',
        durationMs: Date.now() - started,
      });
      return {
        ...creditProfilePublic(profile),
        syncedAt,
        attemptedAt: syncedAt,
        coreComplete: true,
        accounts: includedAccounts.map((account) =>
          genericMonthlyAccount(account, profile.provider, {
            startDate,
            futureMonths: scope.futureMonths,
            now: this.now(),
          })
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
      throw failure;
    }
  }
}
