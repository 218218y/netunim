// @ts-nocheck
import { CreditProviderAdapter } from './credit-adapter-base.mjs';
import {
  CAL_ENDPOINTS,
  CAL_STATIC_HEADERS,
  VISA_CAL_PROVIDER_SCHEMA_VERSION,
} from './credit-adapter-wire.mjs';
import { postVisaCalJson } from './credit-http.mjs';
import { safeCreditResponseShape } from './credit-diagnostic-model.mjs';
import { creditSyncScope } from './credit-sync-scope.mjs';
import { buildCreditMonthPlan } from './credit-month-plan.mjs';
import {
  applyVisaCalLoginNavigationPolicy,
  prepareVisaCalBrowserIdentity,
} from './visa-cal-session.mjs';
import {
  creditLoginThrownScrapeFailure,
  creditProfilePublic,
  creditScrapeFailure,
  normalizeCreditScrapeAccount,
} from './lib.mjs';
import { errorFetchStatus, safeError, safeSuffix, text } from './credit-value-codec.mjs';
import {
  firstVisaCalRawTransaction,
  parseVisaCalFrame,
  parseVisaCalMonthData,
  parseVisaCalPending,
} from './visa-cal-model.mjs';
import {
  coverageError,
  monthlyCoverageFailure,
  monthlyCoverageSuccess,
} from './credit-coverage.mjs';
import { sleep } from './credit-scheduler.mjs';

export class VisaCalAdapter extends CreditProviderAdapter {
  constructor(options = {}) {
    super(options);
    this.connectorVersion = VISA_CAL_PROVIDER_SCHEMA_VERSION;
    Object.assign(this, {
      createScraper: options.createScraper,
      CompanyTypes: options.CompanyTypes,
      browserPath: options.browserPath,
      identityProbeUrl: options.identityProbeUrl || '',
      interactive: !!options.interactive,
      fetchImpl: options.fetchImpl || globalThis.fetch,
      requestDelayMs: Number.isFinite(options.requestDelayMs) ? options.requestDelayMs : 650,
      excludedAccountNumbers: this.excludedAccountNumbers,
    });
  }
  async request(url, data, stage) {
    if (this.blockingError) throw this.blockingError;
    const started = Date.now();
    try {
      const result = await postVisaCalJson(this.page, this.fetchImpl, url, data, {
        browserHeaders: this.browserHeaders,
        nodeHeaders: this.nodeHeaders,
        stage,
        now: this.now().getTime(),
      });
      this.event({
        stage,
        durationMs: Date.now() - started,
        transport: result.transport,
        responseShape: safeCreditResponseShape(result.data),
      });
      return result.data;
    } catch (error) {
      if (
        ['CREDIT_AUTOMATION_BLOCKED', 'CREDIT_PROVIDER_RATE_LIMITED'].includes(
          String(error?.code || '')
        )
      ) {
        error.originalFailureAt = error.originalFailureAt || this.now().toISOString();
        this.blockingError = error;
      }
      this.event({
        stage,
        durationMs: Date.now() - started,
        transport: error?.transport || '',
        errorClass: error?.code,
        httpStatus: error?.httpStatus,
        retryAfterAt: error?.retryAfterAt,
      });
      throw error;
    }
  }
  async scrape() {
    const profile = this.profile,
      scope = creditSyncScope({ syncMode: this.syncMode, now: this.now() }),
      startDate = scope.startDate,
      plan = buildCreditMonthPlan({ startDate, futureMonths: scope.futureMonths, now: this.now() }),
      scraper = applyVisaCalLoginNavigationPolicy(
        this.createScraper({
          companyId: this.CompanyTypes.visaCal,
          startDate,
          futureMonthsToScrape: 0,
          combineInstallments: false,
          showBrowser: this.interactive,
          executablePath: this.browserPath,
          navigationRetryCount: 1,
          defaultTimeout: 45_000,
          timeout: 90_000,
          additionalTransactionInformation: false,
          includeRawTransaction: false,
        })
      );
    let initialized = false,
      success = false;
    try {
      await scraper.initialize();
      initialized = true;
      this.event({ stage: 'BrowserInit' });
      let browserIdentity;
      try {
        browserIdentity = await prepareVisaCalBrowserIdentity(scraper.page, {
          identityProbeUrl: this.identityProbeUrl,
        });
        this.event({
          stage: 'BrowserIdentity',
          clientHintsState: browserIdentity.clientHintsState,
          browserMajorVersion: browserIdentity.browserMajorVersion,
        });
      } catch (error) {
        this.event({
          stage: 'BrowserIdentity',
          errorClass: error?.code || 'CREDIT_BROWSER_IDENTITY_UNAVAILABLE',
          clientHintsState: error?.clientHintsState || '',
          browserMajorVersion: error?.browserMajorVersion || 0,
        });
        throw error;
      }
      let loginResult,
        loginStarted = Date.now();
      try {
        loginResult = await scraper.login(profile.credentials);
      } catch (error) {
        const loginStep = [
            'navigation',
            'landing-readiness',
            'open-login-popup',
            'credentials-submit',
            'post-submit-navigation',
            'result-detection',
          ].includes(String(scraper.__netunimLoginStep || ''))
            ? String(scraper.__netunimLoginStep)
            : '',
          loginState = String(error?.loginState || '');
        const failure = creditLoginThrownScrapeFailure(error, profile);
        if (loginStep) failure.loginStep = loginStep;
        if (loginState) failure.loginState = loginState;
        this.event({
          stage: failure.stage || 'LoginFlow',
          durationMs: Date.now() - loginStarted,
          errorClass: failure.code,
          loginStep,
          loginState,
        });
        throw failure;
      }
      if (!loginResult?.success) throw creditScrapeFailure(loginResult, profile);
      this.event({ stage: 'Login', durationMs: Date.now() - loginStarted });
      let cards;
      try {
        cards = await scraper.getCards();
      } catch {
        throw safeError(
          'נתוני init ורשימת הכרטיסים של כאל לא נמצאו לאחר הכניסה.',
          'CREDIT_SESSION_INIT_MISSING',
          { stage: 'DashboardInit' }
        );
      }
      if (!Array.isArray(cards) || !cards.length)
        throw safeError('כאל לא החזירה רשימת כרטיסים תקינה.', 'CREDIT_PROVIDER_SCHEMA_ERROR', {
          stage: 'DashboardInit',
        });
      let authorization;
      try {
        authorization = await scraper.getAuthorizationHeader();
      } catch {
        throw safeError('אסימון ההרשאה של כאל לא נמצא לאחר הכניסה.', 'CREDIT_AUTH_TOKEN_MISSING', {
          stage: 'AuthToken',
        });
      }
      if (!String(authorization || '').trim())
        throw safeError('אסימון ההרשאה של כאל ריק.', 'CREDIT_AUTH_TOKEN_MISSING', {
          stage: 'AuthToken',
        });
      const xSiteId = await scraper.getXSiteId();
      this.page = scraper.page;
      this.browserHeaders = { Authorization: authorization, 'X-Site-Id': xSiteId };
      this.nodeHeaders = {
        ...this.browserHeaders,
        ...browserIdentity.requestHeaders,
        ...CAL_STATIC_HEADERS,
      };
      const accounts = [],
        errors = [],
        dataDiagnostics = [];
      for (const card of cards) {
        const accountNumber = text(card?.last4Digits, 80);
        if (this.excludedAccountNumbers.has(accountNumber)) {
          this.event({ stage: 'CardExcluded', accountSuffix: safeSuffix(accountNumber) });
          continue;
        }
        const at = this.now().toISOString(),
          account = {
            accountNumber,
            balance: null,
            balanceDate: null,
            cardType: '',
            cardFrame: null,
            availableCredit: null,
            frameStatus: 'missing',
            frameFetchStatus: 'unavailable',
            frameFetchedAt: null,
            frameErrorCode: '',
            frameErrorAt: null,
            pendingTransactions: [],
            pendingStatus: 'missing',
            months: [],
          };
        try {
          const parsed = parseVisaCalFrame(
              await this.request(
                CAL_ENDPOINTS.frames,
                { cardsForFrameData: [{ cardUniqueId: card.cardUniqueId }] },
                'Frames'
              ),
              card
            ),
            warning = parsed.warning;
          delete parsed.warning;
          Object.assign(account, parsed);
          if (parsed.frameFetchStatus === 'success') account.frameFetchedAt = at;
          if (warning) {
            account.frameErrorCode = warning.code;
            account.frameErrorAt = at;
            errors.push(
              coverageError(profile, warning, {
                accountNumber,
                at,
                component: 'frames',
                severity: 'warning',
              })
            );
          }
        } catch (error) {
          account.frameFetchStatus = errorFetchStatus(error);
          account.frameErrorCode = error.code;
          account.frameErrorAt = at;
          errors.push(
            coverageError(profile, error, {
              accountNumber,
              at,
              component: 'frames',
              severity: 'warning',
            })
          );
        }
        if (!this.blockingError && this.requestDelayMs > 0) await sleep(this.requestDelayMs);
        try {
          account.pendingTransactions = parseVisaCalPending(
            await this.request(
              CAL_ENDPOINTS.pending,
              { cardUniqueIDArray: [card.cardUniqueId] },
              'Pending'
            )
          );
          account.pendingStatus = 'success';
          account.pendingFetchedAt = at;
        } catch (error) {
          account.pendingStatus = errorFetchStatus(error);
          account.pendingErrorCode = error.code;
          account.pendingErrorAt = at;
          errors.push(
            coverageError(profile, error, {
              accountNumber,
              at,
              component: 'pending',
              severity: 'warning',
            })
          );
        }
        for (const entry of plan) {
          if (!this.blockingError && this.requestDelayMs > 0) await sleep(this.requestDelayMs);
          try {
            const data = await this.request(
                CAL_ENDPOINTS.transactions,
                {
                  cardUniqueId: card.cardUniqueId,
                  month: String(Number(entry.month.slice(5, 7))),
                  year: entry.month.slice(0, 4),
                },
                `Transactions ${entry.month}`
              ),
              rawSample = dataDiagnostics.some((row) => row.accountNumber === accountNumber)
                ? null
                : firstVisaCalRawTransaction(data),
              transactions = parseVisaCalMonthData(data, {
                startDate: entry.month === plan[0].month ? startDate : null,
              });
            if (rawSample)
              dataDiagnostics.push({
                profileId: profile.profileId,
                accountNumber,
                rawTransaction: rawSample,
              });
            account.months.push(
              monthlyCoverageSuccess(entry, transactions, this.now().toISOString())
            );
          } catch (error) {
            const failedAt = this.now().toISOString();
            account.months.push(monthlyCoverageFailure(entry, error, failedAt));
            errors.push(
              coverageError(profile, error, {
                month: entry.month,
                tier: entry.tier,
                accountNumber,
                at: failedAt,
                component: entry.tier === 'core' ? 'core_transactions' : 'forecast_transactions',
                severity: entry.tier === 'core' ? 'error' : 'warning',
              })
            );
          }
        }
        accounts.push(normalizeCreditScrapeAccount(account, profile.provider));
      }
      const coreComplete = accounts.every((account) =>
          account.months
            .filter((slice) => slice.tier === 'core')
            .every((slice) => slice.fetchStatus === 'success')
        ),
        forecastFailures = errors.filter((error) => error.tier === 'forecast').length,
        coreFailures = errors.filter((error) => error.tier === 'core').length,
        syncedAt = coreComplete ? this.now().toISOString() : null;
      const blocked = !!this.blockingError;
      if (forecastFailures)
        errors.unshift({
          profileId: profile.profileId,
          provider: profile.provider,
          label: profile.label,
          code: 'CREDIT_PARTIAL_FORECAST',
          stage: 'Forecast',
          component: 'forecast_transactions',
          severity: blocked ? 'deferred' : 'warning',
          httpStatus: 0,
          message: blocked
            ? `קריאות התחזית הושהו לאחר 403/429; ${forecastFailures} מקטעים לא נשלחו ו־Last Known Good נשמר.`
            : `לכאל חסרים ${forecastFailures} מקטעי תחזית; נתונים קודמים נשמרים כ־Last Known Good.`,
          at: this.blockingError?.originalFailureAt || this.now().toISOString(),
          originalFailureAt: this.blockingError?.originalFailureAt || null,
          retryAfterAt: this.blockingError?.retryAfterAt || null,
        });
      if (coreFailures)
        errors.unshift({
          profileId: profile.profileId,
          provider: profile.provider,
          label: profile.label,
          code: 'CREDIT_CORE_COVERAGE_INCOMPLETE',
          stage: 'CoreCoverage',
          component: 'core_transactions',
          severity: blocked ? 'deferred' : 'error',
          httpStatus: 0,
          message: blocked
            ? `קריאות Core הושהו לאחר 403/429; ${coreFailures} מקטעים לא נשלחו, שעון ההצלחה לא התקדם ו־Last Known Good נשמר.`
            : `לכאל חסרים ${coreFailures} מקטעי ליבה; זמן ההצלחה המלאה לא התקדם ונתוני Last Known Good נשמרו.`,
          at: this.blockingError?.originalFailureAt || this.now().toISOString(),
          originalFailureAt: this.blockingError?.originalFailureAt || null,
          retryAfterAt: this.blockingError?.retryAfterAt || null,
        });
      success = coreComplete;
      return {
        ...creditProfilePublic(profile),
        syncedAt,
        attemptedAt: this.now().toISOString(),
        coreComplete,
        accounts,
        errors,
        _dataDiagnostics: dataDiagnostics,
      };
    } finally {
      if (initialized)
        try {
          await scraper.terminate(success);
        } catch {}
    }
  }
}
