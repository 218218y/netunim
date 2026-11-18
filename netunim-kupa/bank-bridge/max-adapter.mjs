// @ts-check
import { providerRecord, safeError, safeSuffix } from './credit-value-codec.mjs';
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
  creditThrownScrapeFailure,
  requireCreditLoginSuccess,
} from './credit-failure-policy.mjs';
import { creditProfilePublic } from './credit-profile-model.mjs';
import {
  extractMaxTransactionCandidates,
  maxCategories,
  maxHomeCards,
  maxResponseEvidence,
  maxRawTransactionTime,
  normalizeMaxRawTransaction,
} from './max-model.mjs';
import { maxGetJsonWithinPage } from './credit-http.mjs';
import { coverageError, monthlyCoverageFailure } from './credit-coverage.mjs';
import { normalizeCreditScrapeAccount } from './credit-transaction-model.mjs';
import { CreditProviderAdapter } from './credit-adapter-base.mjs';
import {maxResponseShape,maxResponseDecision,optionalMaxMonthFailure} from './max-response-diagnostics.mjs';

/**
 * @typedef {import('./credit-model-contracts.js').CreditProfileInput} CreditProfile
 * @typedef {import('./credit-model-contracts.js').CreditProfileResult} CreditProfileResult
 * @typedef {import('./credit-http.mjs').CreditPage} CreditPage
 * @typedef {NonNullable<ReturnType<typeof normalizeMaxRawTransaction>>} MaxTransaction
 * @typedef {{initialize:()=>Promise<unknown>,login:(credentials:CreditProfile['credentials'])=>Promise<unknown>,terminate:(success:boolean)=>Promise<unknown>,page?:CreditPage}} MaxScraper
 * @typedef {{companyId:string,startDate:Date,futureMonthsToScrape:number,combineInstallments:boolean,showBrowser:boolean,executablePath:string|undefined,navigationRetryCount:number,defaultTimeout:number,timeout:number,additionalTransactionInformation:boolean,includeRawTransaction:boolean,outputData:{enableTransactionsFilterByDate:boolean}}} MaxScraperOptions
 * @typedef {import('./credit-adapter-base.mjs').AdapterOptions & {companyId:string,createScraper:(options:MaxScraperOptions)=>MaxScraper}} MaxAdapterOptions
 */

/** @param {string} month */
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

/** @param {{homeCards:ReturnType<typeof maxHomeCards>,rawByCard:Map<string,MaxTransaction[]>,profile:CreditProfile,startDate:Date,futureMonths:number,now:Date,excludedAccountNumbers:Set<string>,monthFailures:Map<string,Record<string,unknown>>}} input */
function maxMonthlyAccounts({
  homeCards,
  rawByCard,
  profile,
  startDate,
  futureMonths,
  now,
  excludedAccountNumbers,
  monthFailures,
}) {
  const allNumbers = new Set([...homeCards.keys(), ...rawByCard.keys()]),
    accounts = [];
  for (const accountNumber of [...allNumbers].sort()) {
    if (excludedAccountNumbers.has(accountNumber)) {
      continue;
    }
    const card = homeCards.get(accountNumber) || {},
      txns = rawByCard.get(accountNumber) || [];
    const account = genericMonthlyAccount(
        { ...card, accountNumber, txns },
        profile.provider,
        { startDate, futureMonths, now },
        MAX_PROVIDER_SCHEMA_VERSION
      );
    const months = account.months.map(slice => {
      const error = monthFailures.get(slice.month);
      return error
        ? { ...monthlyCoverageFailure(slice, error, now.toISOString()), providerSchemaVersion: MAX_PROVIDER_SCHEMA_VERSION }
        : slice;
    });
    accounts.push(normalizeCreditScrapeAccount({ ...account, months }, profile.provider));
  }
  return accounts;
}

/** @param {MaxAdapter} adapter @returns {Promise<CreditProfileResult>} */
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
  const dataDiagnostics=[];
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
      const detail = providerRecord(failure);
      adapter.event({
        stage: detail?.stage || 'LoginFlow',
        durationMs: Date.now() - loginStarted,
        errorClass: failure.code,
      });
      throw failure;
    }
    requireCreditLoginSuccess(loginResult, profile);
    adapter.event({ stage: 'Login', durationMs: Date.now() - loginStarted });
    const page = scraper?.page;
    if (!page || typeof page.evaluate !== 'function')
      throw safeError(
        'מחבר MAX המותקן אינו חושף page לאחר ההתחברות.',
        'CREDIT_CONNECTOR_COMPATIBILITY_ERROR',
        { stage: 'MaxData' }
      );
    /** @type {Map<number,string>} */
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
      const detail = providerRecord(error);
      adapter.event({
        stage: 'MaxCategories',
        errorClass: detail?.code || 'CREDIT_PROVIDER_DATA_ERROR',
        httpStatus: detail?.httpStatus || 0,
      });
    }
    const homeData = await maxGetJsonWithinPage(
        page,
        MAX_HOME_PAGE_DATA_URL,
        'MaxHomeCards',
        adapter.now().getTime()
      ),
      homeCards = maxHomeCards(homeData);
    /** @type {Map<string,MaxTransaction[]>} */
    const rawByCard = new Map();
    /** @type {Map<string,Record<string,unknown>>} */
    const monthFailures = new Map();
    const errors = [];
    for (const entry of plan) {
      const monthStarted = Date.now(),buffer=[];
      let shape=maxResponseShape(undefined),parsed;
      /** @type {'fetch'|'parse'|'normalize'} */
      let phase='fetch';
      /** @type {unknown} */
      let errorForDiagnostic=null;
      try {
        const data = await maxGetJsonWithinPage(
          page,
          maxTransactionsUrl(entry.month),
          `MaxTransactions ${entry.month}`,
          adapter.now().getTime(),
          reply=>{shape=maxResponseShape('data' in reply ? reply.data : undefined,reply)}
        );
        phase='parse';
        parsed = extractMaxTransactionCandidates(data);
        phase='normalize';
        for(const raw of parsed.transactions){
          const tx=normalizeMaxRawTransaction(raw,categories),accountNumber=safeSuffix(raw?.shortCardNumber);
          if(!tx||!accountNumber)throw safeError('רשומת MAX שזוהתה לא ניתנת לנרמול. הנתונים הקודמים נשמרו.', 'CREDIT_PROVIDER_SCHEMA_ERROR', { stage: `MaxTransactions ${entry.month}` });
          buffer.push({accountNumber,tx});
        }
        for(const {accountNumber,tx} of buffer){
          const rows = rawByCard.get(accountNumber);
          if (rows) rows.push(tx);
          else rawByCard.set(accountNumber,[tx]);
        }
      }
      catch (error) {
        errorForDiagnostic=error;
        if (optionalMaxMonthFailure(error)) {
          error.stage = `MaxTransactions ${entry.month}`;
          if (entry.tier === 'forecast') {
            monthFailures.set(entry.month, error);
            errors.push(coverageError(profile, error, { month: entry.month, tier: entry.tier, at: adapter.now().toISOString() }));
            adapter.event({ stage: error.stage, month: entry.month, errorClass: error.code,httpStatus:error.httpStatus||0 });
            continue;
          }
        }
        throw error;
      } finally {
        const decision=maxResponseDecision(shape,errorForDiagnostic,phase);
        if(!errorForDiagnostic&&parsed?.transactions.length)decision.outcome='verified_rows';
        dataDiagnostics.push({...maxResponseEvidence(profile.profileId,entry.month,parsed?.evidence||{},homeCards.size,adapter.excludedAccountNumbers),
          response:{...shape,...decision,tier:entry.tier}});
      }
      adapter.event({
        stage: 'MaxTransactions',
        month: entry.month,
        durationMs: Date.now() - monthStarted,
      });
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
        monthFailures,
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
      errors,
      _dataDiagnostics: dataDiagnostics,
    };
  } catch (error) {
    const failure = creditThrownScrapeFailure(error, profile);
    const detail = providerRecord(failure);
    Object.defineProperty(failure,'_dataDiagnostics',{value:dataDiagnostics,enumerable:false});
    if (detail && !detail.browserEngine) detail.browserEngine = 'chromium';
    adapter.event({
      browserEngine: 'chromium',
      stage: detail?.stage || 'Scrape',
      durationMs: Date.now() - started,
      errorClass: failure?.code,
      httpStatus: detail?.httpStatus,
      providerStatus: detail?.providerStatus,
      providerReturnCode: detail?.providerReturnCode,
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
  /** @param {MaxAdapterOptions} options */
  constructor(options) {
    super(options);
    this.connectorVersion = MAX_PROVIDER_SCHEMA_VERSION;
    this.createScraper = options.createScraper;
    this.companyId = options.companyId;
    this.browserPath = options.browserPath;
    this.interactive = !!options.interactive;
  }
  async scrape() {
    return scrapeMaxDirect(this);
  }
}
