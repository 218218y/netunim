// @ts-check
import { text } from './credit-value-codec.mjs';
import { CREDIT_SYNC_MODE_QUICK } from './credit-adapter-wire.mjs';
import { normalizeCreditSyncMode } from './credit-sync-scope.mjs';

/**
 * @typedef {import('./credit-model-contracts.js').CreditProfileInput} CreditProfile
 * @typedef {(event:Record<string,unknown>)=>void} DiagnosticSink
 * @typedef {{profile:CreditProfile,onDiagnostic?:DiagnosticSink,correlationId?:string,now?:()=>Date,syncMode?:string,interactive?:boolean,browserPath?:string,excludedAccountNumbers?:string[]}} AdapterOptions
 */

/** @param {string[]} values */
function excludedAccountSet(values) {
  return new Set(
    (Array.isArray(values) ? values : []).map((value) => text(value, 80)).filter(Boolean)
  );
}

/** @param {DiagnosticSink} onDiagnostic @param {Record<string,unknown>} event */
function diagnostic(onDiagnostic, event) {
  try {
    onDiagnostic?.(event);
  } catch {}
}

/** @param {string} browserPath */
function diagnosticBrowserProduct(browserPath) {
  const name = String(browserPath || '')
    .replace(/\\/g, '/')
    .split('/')
    .pop()?.toLowerCase();
  if (name === 'msedge.exe') return 'edge';
  if (name === 'chrome.exe') return 'chrome';
  return '';
}

export class CreditProviderAdapter {
  /** @param {AdapterOptions} options */
  constructor({
    profile,
    onDiagnostic = () => {},
    correlationId = '',
    now = () => new Date(),
    syncMode = CREDIT_SYNC_MODE_QUICK,
    interactive = false,
    browserPath = '',
    excludedAccountNumbers = [],
  }) {
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
  /** @param {Record<string,unknown>} event */
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
  /** @returns {Promise<import('./credit-model-contracts.js').CreditProfileResult>} */
  async scrape() {
    throw new Error('CreditProviderAdapter.scrape must be implemented');
  }
}
