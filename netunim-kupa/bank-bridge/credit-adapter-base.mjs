// @ts-nocheck
import { text } from './credit-value-codec.mjs';
import { CREDIT_SYNC_MODE_QUICK } from './credit-adapter-wire.mjs';
import { normalizeCreditSyncMode } from './credit-sync-scope.mjs';

function excludedAccountSet(values = []) {
  return new Set(
    (Array.isArray(values) ? values : []).map((value) => text(value, 80)).filter(Boolean)
  );
}

function diagnostic(onDiagnostic, event) {
  try {
    onDiagnostic?.(event);
  } catch {}
}

function diagnosticBrowserProduct(browserPath) {
  const name = String(browserPath || '')
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    .toLowerCase();
  if (name === 'msedge.exe') return 'edge';
  if (name === 'chrome.exe') return 'chrome';
  return '';
}

export class CreditProviderAdapter {
  constructor({
    profile,
    onDiagnostic = () => {},
    correlationId = '',
    now = () => new Date(),
    syncMode = CREDIT_SYNC_MODE_QUICK,
    interactive = false,
    browserPath = '',
    excludedAccountNumbers = [],
  } = {}) {
    this.profile = profile;
    this.onDiagnostic = onDiagnostic;
    this.correlationId = correlationId;
    this.now = now;
    this.syncMode = normalizeCreditSyncMode(syncMode);
    this.browserMode = interactive ? 'headed' : 'headless';
    this.browserProduct = diagnosticBrowserProduct(browserPath);
    this.connectorVersion = '';
    this.excludedAccountNumbers = excludedAccountSet(excludedAccountNumbers);
  }
  event(event) {
    const engine = String(event?.browserEngine || '');
    diagnostic(this.onDiagnostic, {
      correlationId: this.correlationId,
      provider: this.profile?.provider,
      profileId: this.profile?.profileId,
      connectorVersion: this.connectorVersion || undefined,
      syncMode: this.syncMode,
      browserMode: this.browserMode,
      browserProduct: engine === 'camoufox' ? 'camoufox' : this.browserProduct,
      ...event,
    });
  }
  async scrape() {
    throw new Error('CreditProviderAdapter.scrape must be implemented');
  }
}
