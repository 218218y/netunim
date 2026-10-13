// @ts-nocheck
import { CREDIT_SYNC_MODE_QUICK } from './credit-adapter-wire.mjs';
import { VisaCalAdapter } from './visa-cal-adapter.mjs';
import { MaxAdapter } from './max-adapter.mjs';
import { AmexAdapter, IsracardAdapter } from './isracard-group-adapter.mjs';
import { safeError } from './credit-value-codec.mjs';

export function createCreditProviderAdapter({
  profile,
  CompanyTypes,
  createScraper,
  browserPath,
  identityProbeUrl = '',
  interactive = false,
  identityDir = '',
  onDiagnostic = () => {},
  correlationId = '',
  now = () => new Date(),
  fetchImpl = globalThis.fetch,
  requestDelayMs,
  syncMode = CREDIT_SYNC_MODE_QUICK,
  excludedAccountNumbers = [],
  allowCamoufoxFallback = true,
  isracardScrapeImpl = null,
  amexScrapeImpl = null,
} = {}) {
  const common = {
    profile,
    CompanyTypes,
    createScraper,
    browserPath,
    identityProbeUrl,
    interactive,
    identityDir,
    onDiagnostic,
    correlationId,
    now,
    fetchImpl,
    requestDelayMs,
    syncMode,
    excludedAccountNumbers,
    allowCamoufoxFallback,
    isracardScrapeImpl,
    amexScrapeImpl,
  };
  if (profile.provider === 'visaCal') return new VisaCalAdapter(common);
  if (profile.provider === 'max') return new MaxAdapter({ ...common, companyId: CompanyTypes.max });
  if (profile.provider === 'isracard')
    return new IsracardAdapter({ ...common, companyId: CompanyTypes.isracard });
  if (profile.provider === 'amex')
    return new AmexAdapter({ ...common, companyId: CompanyTypes.amex });
  throw safeError(
    'חברת האשראי שנבחרה אינה נתמכת ב־Credit Connector v2.',
    'CREDIT_PROVIDER_UNAVAILABLE'
  );
}
