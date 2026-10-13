// Synthetic issuer responses exercise the staged adapter's serialized callbacks.
// No browser, upstream package, credentials file or external request is opened.
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
const app = path.join(process.env.LOCALAPPDATA, 'NetunimKupaBankBridge');
const trace = (event) =>
  fs.appendFile(path.join(app, 'fixture-credit-trace.jsonl'), JSON.stringify(event) + '\n');
export const CompanyTypes = { max: 'max' };
async function fetchFixture(value) {
  const url = new URL(value);
  if (!['https://www.max.co.il', 'https://onlinelcapi.max.co.il'].includes(url.origin))
    throw new Error('unexpected synthetic issuer origin');
  await trace({ stage: 'request', path: url.pathname });
  let data;
  if (url.pathname === '/api/contents/getCategories') data = { result: [] };
  else if (url.pathname === '/api/registered/getHomePageData')
    data = {
      Result: {
        UserCards: {
          Cards: [{ Last4Digits: '0042', CreditLimit: 100, OpenToBuy: 75, CycleSummary: [] }],
        },
      },
    };
  else if (url.pathname === '/api/registered/transactionDetails/getTransactionsAndGraphs') {
    const selected = JSON.parse(url.searchParams.get('filterData')).date;
    const [year, month] = selected.split('-');
    data = {
      result: {
        transactions: [
          {
            shortCardNumber: '0042',
            purchaseDate: '2026-10-12T14:20:00',
            paymentDate: year + '-' + month.padStart(2, '0') + '-15',
            merchantName: 'Synthetic purchase',
            actualPaymentAmount: 25,
            paymentCurrency: 'ILS',
            originalAmount: 25,
            originalCurrency: 'ILS',
            arn: 'fixture-' + selected,
          },
        ],
      },
    };
  } else throw new Error('unexpected synthetic issuer endpoint');
  return { status: 200, headers: { get: () => null }, text: async () => JSON.stringify(data) };
}
export function createScraper(options) {
  const page = {
    evaluate: async (callback, input) =>
      vm.runInNewContext('(' + callback.toString() + ')(input)', { input, fetch: fetchFixture }),
  };
  return {
    page,
    initialize: async () =>
      trace({
        stage: 'initialize',
        companyId: options.companyId,
        futureMonths: options.futureMonthsToScrape,
        navigationRetryCount: options.navigationRetryCount,
      }),
    login: async (credentials) => {
      if (credentials.password !== ' exact synthetic secret ')
        throw new Error('credential value changed');
      await trace({ stage: 'login' });
      return { success: true };
    },
    terminate: async (success) => {
      await trace({ stage: 'terminate', success });
      await fs.writeFile(path.join(app, 'fixture-credit-terminate-entered'), 'entered');
      while (true) {
        try {
          await fs.access(path.join(app, 'fixture-credit-terminate-release'));
          break;
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }
      await trace({ stage: 'terminated' });
    },
  };
}
