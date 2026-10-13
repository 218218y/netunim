// @ts-nocheck
import { safeError, safeSuffix } from './credit-value-codec.mjs';
import {
  MAX_BASE_API_ACTIONS_URL,
  MAX_CATEGORIES_URL,
  MAX_HOME_PAGE_DATA_URL,
  MAX_PROVIDER_SCHEMA_VERSION,
} from './credit-adapter-wire.mjs';
import { genericMonthlyAccount } from './credit-monthly-projection.mjs';
import { creditSyncScope } from './credit-sync-scope.mjs';
import { buildCreditMonthPlan } from './credit-month-plan.mjs';
import {
  creditLoginThrownScrapeFailure,
  creditProfilePublic,
  creditScrapeFailure,
  creditThrownScrapeFailure,
} from './lib.mjs';
import {
  extractMaxTransactionCandidates,
  maxCategories,
  maxHomeCards,
  maxResponseEvidence,
  normalizeMaxRawTransaction,
} from './max-model.mjs';
import { maxGetJsonWithinPage } from './credit-http.mjs';
import { coverageError } from './credit-coverage.mjs';
import { maxRawTransactionTime } from './credit-data-diagnostics.mjs';
import { CreditProviderAdapter } from './credit-adapter-base.mjs';

function maxTransactionsUrl(month) {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(month || ''));
  if (!match)
    throw safeError('חודש MAX שנבנה לסנכרון אינו תקין.', 'CREDIT_PROVIDER_SCHEMA_ERROR', {
      stage: 'MaxMonth',
    });
  const url = new URL(
      `${MAX_BASE_API_ACTIONS_URL}/api/registered/transactionDetails/getTransactionsAndGraphs`
    ),
    date = `${match[1]}-${Number(match[2])}-01`;
  url.searchParams.set(
    'filterData',
    JSON.stringify({
      userIndex: -1,
      cardIndex: -1,
      monthView: true,
      date,
      dates: { startDate: '0', endDate: '0' },
      bankAccount: { bankAccountIndex: -1, cards: null },
    })
  );
  url.searchParams.set('firstCallCardIndex', '-1');
  return url.toString();
}

function maxMonthlyAccounts({
  homeCards,
  rawByCard,
  profile,
  startDate,
  futureMonths,
  now,
  excludedAccountNumbers,
}) {
  const allNumbers = new Set([...homeCards.keys(), ...rawByCard.keys()]),
    accounts = [];
  for (const accountNumber of [...allNumbers].sort()) {
    if (excludedAccountNumbers.has(accountNumber)) {
      continue;
    }
    const card = homeCards.get(accountNumber) || {},
      txns = rawByCard.get(accountNumber) || [];
    accounts.push(
      genericMonthlyAccount(
        { ...card, accountNumber, txns },
        profile.provider,
        { startDate, futureMonths, now },
        MAX_PROVIDER_SCHEMA_VERSION
      )
    );
  }
  return accounts;
}

async function scrapeMaxDirect(adapter) {
  const profile = adapter.profile,
    scope = creditSyncScope({ syncMode: adapter.syncMode, now: adapter.now() }),
    startDate = scope.startDate,
    plan = buildCreditMonthPlan({
      startDate,
      futureMonths: scope.futureMonths,
      now: adapter.now(),
    }),
    scraper = adapter.createScraper({
      companyId: adapter.companyId,
      startDate,
      futureMonthsToScrape: scope.futureMonths,
      combineInstallments: false,
      showBrowser: adapter.interactive,
      executablePath: adapter.browserPath,
      navigationRetryCount: 1,
      defaultTimeout: 45_000,
      timeout: 90_000,
      additionalTransactionInformation: false,
      includeRawTransaction: true,
      outputData: { enableTransactionsFilterByDate: false },
    }),
    started = Date.now();
  let initialized = false,
    success = false;
  try {
    await scraper.initialize();
    initialized = true;
    adapter.event({ stage: 'BrowserInit' });
    const loginStarted = Date.now();
    let loginResult;
    try {
      loginResult = await scraper.login(profile.credentials);
    } catch (error) {
      const failure = creditLoginThrownScrapeFailure(error, profile);
      adapter.event({
        stage: failure.stage || 'LoginFlow',
        durationMs: Date.now() - loginStarted,
        errorClass: failure.code,
      });
      throw failure;
    }
    if (!loginResult?.success) throw creditScrapeFailure(loginResult, profile);
    adapter.event({ stage: 'Login', durationMs: Date.now() - loginStarted });
    const page = scraper?.page;
    if (!page || typeof page.evaluate !== 'function')
      throw safeError(
        'מחבר MAX המותקן אינו חושף page לאחר ההתחברות.',
        'CREDIT_CONNECTOR_COMPATIBILITY_ERROR',
        { stage: 'MaxData' }
      );
    let categories = new Map();
    try {
      categories = maxCategories(
        await maxGetJsonWithinPage(
          page,
          MAX_CATEGORIES_URL,
          'MaxCategories',
          adapter.now().getTime()
        )
      );
    } catch (error) {
      adapter.event({
        stage: 'MaxCategories',
        errorClass: error?.code || 'CREDIT_PROVIDER_DATA_ERROR',
        httpStatus: error?.httpStatus || 0,
      });
    }
    const homeData = await maxGetJsonWithinPage(
        page,
        MAX_HOME_PAGE_DATA_URL,
        'MaxHomeCards',
        adapter.now().getTime()
      ),
      homeCards = maxHomeCards(homeData),
      rawByCard = new Map(),
      dataDiagnostics = [];
    for (const entry of plan) {
      const monthStarted = Date.now(),
        data = await maxGetJsonWithinPage(
          page,
          maxTransactionsUrl(entry.month),
          `MaxTransactions ${entry.month}`,
          adapter.now().getTime()
        ),
        parsed = extractMaxTransactionCandidates(data || {});
      dataDiagnostics.push(
        maxResponseEvidence(
          profile.profileId,
          entry.month,
          parsed.evidence,
          homeCards.size,
          adapter.excludedAccountNumbers
        )
      );
      adapter.event({
        stage: 'MaxTransactions',
        month: entry.month,
        durationMs: Date.now() - monthStarted,
      });
      for (const raw of parsed.transactions) {
        const tx = normalizeMaxRawTransaction(raw, categories),
          accountNumber = safeSuffix(raw?.shortCardNumber);
        if (!tx || !accountNumber) continue;
        if (!rawByCard.has(accountNumber)) rawByCard.set(accountNumber, []);
        rawByCard.get(accountNumber).push(tx);
      }
    }
    const discoveredNumbers = new Set([...homeCards.keys(), ...rawByCard.keys()]);
    if (!discoveredNumbers.size) {
      // Preserve Last Known Good and, crucially, return the sanitized response-shape
      // evidence to the diagnostic exporter. Throwing here would hide the exact
      // authenticated MAX shape that is needed when their private API changes.
      const attemptedAt = adapter.now().toISOString(),
        schemaFailure = safeError(
          'MAX אישרה את הכניסה אך לא הוחזרה אפילו רשומת כרטיס אחת מנתוני הבית או מפירוט העסקאות. הסנכרון לא יסומן כהצלחה ריקה.',
          'CREDIT_PROVIDER_SCHEMA_ERROR',
          { stage: 'MaxCards' }
        ),
        error = coverageError(profile, schemaFailure, {
          at: attemptedAt,
          component: 'core_transactions',
          severity: 'error',
        });
      adapter.event({
        browserEngine: 'chromium',
        stage: 'MaxCards',
        durationMs: Date.now() - started,
        errorClass: schemaFailure.code,
      });
      return {
        ...creditProfilePublic(profile),
        syncedAt: null,
        attemptedAt,
        coreComplete: false,
        accounts: [],
        errors: [error],
        _dataDiagnostics: dataDiagnostics,
      };
    }
    for (const accountNumber of discoveredNumbers)
      if (adapter.excludedAccountNumbers.has(accountNumber))
        adapter.event({ stage: 'CardExcluded', accountSuffix: safeSuffix(accountNumber) });
    const accounts = maxMonthlyAccounts({
        homeCards,
        rawByCard,
        profile,
        startDate,
        futureMonths: scope.futureMonths,
        now: adapter.now(),
        excludedAccountNumbers: adapter.excludedAccountNumbers,
      }),
      rawSamples = [];
    for (const accountNumber of discoveredNumbers) {
      if (adapter.excludedAccountNumbers.has(accountNumber)) continue;
      const rows = rawByCard.get(accountNumber) || [],
        chosen =
          rows.find(
            (tx) => tx?.rawTransaction && maxRawTransactionTime(tx.rawTransaction).candidates.length
          ) || rows.find((tx) => tx?.rawTransaction);
      if (chosen?.rawTransaction)
        rawSamples.push({
          profileId: profile.profileId,
          accountNumber,
          rawTransaction: chosen.rawTransaction,
        });
    }
    dataDiagnostics.push(...rawSamples);
    const syncedAt = adapter.now().toISOString();
    success = true;
    adapter.event({ stage: 'Complete', durationMs: Date.now() - started });
    return {
      ...creditProfilePublic(profile),
      syncedAt,
      attemptedAt: syncedAt,
      coreComplete: true,
      accounts,
      errors: [],
      _dataDiagnostics: dataDiagnostics,
    };
  } catch (error) {
    const failure = creditThrownScrapeFailure(error, profile);
    if (!failure.browserEngine) failure.browserEngine = 'chromium';
    adapter.event({
      browserEngine: 'chromium',
      stage: failure?.stage || 'Scrape',
      durationMs: Date.now() - started,
      errorClass: failure?.code,
      httpStatus: failure?.httpStatus,
      providerStatus: failure?.providerStatus,
      providerReturnCode: failure?.providerReturnCode,
    });
    throw failure;
  } finally {
    if (initialized)
      try {
        await scraper.terminate(success);
      } catch {}
  }
}

export class MaxAdapter extends CreditProviderAdapter {
  constructor(options = {}) {
    super(options);
    this.connectorVersion = MAX_PROVIDER_SCHEMA_VERSION;
    Object.assign(this, {
      createScraper: options.createScraper,
      CompanyTypes: options.CompanyTypes,
      companyId: options.companyId,
      browserPath: options.browserPath,
      interactive: !!options.interactive,
    });
  }
  async scrape() {
    return scrapeMaxDirect(this);
  }
}
