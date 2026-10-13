import { wholeMoney } from '../../core/money.js';
import { normalizeBankFeed } from './feed.js';

export function createManualBankSnapshot(
  bank,
  balance,
  observedSeq,
  {
    source = 'manual',
    accountNumber = null,
    bankSyncAt = undefined,
    bankFeed = undefined,
    homeBankFeed = undefined,
  } = {},
  { now, today, createToken }
) {
  const previousSyncAt = bank?.bankSyncAt || null;
  const nextSyncAt = bankSyncAt === undefined ? previousSyncAt : bankSyncAt || null;
  const previousFeed = bank?.feed || null;
  const nextFeed = bankFeed === undefined ? previousFeed : normalizeBankFeed(bankFeed);
  const previousHomeFeed = bank?.homeFeed || null;
  const nextHomeFeed =
    homeBankFeed === undefined ? previousHomeFeed : normalizeBankFeed(homeBankFeed);
  return {
    ...bank,
    currentBalance: wholeMoney(balance),
    updatedAt: now(),
    asOfDate: today(),
    snapshotToken: createToken(),
    snapshotSeq: observedSeq,
    adjustments: [],
    source,
    sourceAccount: accountNumber || null,
    bankSyncAt: nextSyncAt,
    feed: nextFeed,
    homeFeed: nextHomeFeed,
  };
}
