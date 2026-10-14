import {
  prepareFinanceConnectionImport,
  financeConnectionImportSummary,
  parseFinanceConnectionImportText,
  FINANCE_CONNECTION_IMPORT_MAX_BYTES,
} from './finance-connection-import.js';
import {
  createFinanceConnectionImportRuntime,
  FINANCE_CONNECTION_IMPORT_MINIMUM_VERSION,
} from './finance-connection-import-runtime.js';
import { createFinanceConnectionFileSelection } from './finance-connection-file-selection.js';

// Browser composition supplies the canonical model and required current UI
// ports. The callable legacy importer and unowned picker are retired.
export function createFinanceConnectionImportCapability({
  bridge,
  getCreditProfiles,
  confirmDialog,
  toast,
  afterImport,
}) {
  for (const [name, method] of Object.entries({
    getCreditProfiles,
    confirmDialog,
    toast,
    afterImport,
  }))
    if (typeof method !== 'function')
      throw new TypeError('finance_connection_import_' + name + '_required');
  for (const name of ['getBridgeToken', 'status', 'importConnectionSettings'])
    if (typeof bridge?.[name] !== 'function')
      throw new TypeError('finance_connection_import_bridge_' + name + '_required');
  const selection = createFinanceConnectionFileSelection({
    decode: parseFinanceConnectionImportText,
    maxBytes: FINANCE_CONNECTION_IMPORT_MAX_BYTES,
  });
  return createFinanceConnectionImportRuntime({
    pairing: { token: () => bridge.getBridgeToken() },
    transport: {
      status: () => bridge.status(),
      replace: (payload) => bridge.importConnectionSettings(payload),
    },
    selection,
    document: {
      prepare: (selected) => {
        const payload = prepareFinanceConnectionImport(selected, getCreditProfiles());
        return { payload, summary: financeConnectionImportSummary(payload) };
      },
    },
    presentation: { confirm: confirmDialog, toast, publish: afterImport },
    protocol: { minimumBridgeVersion: FINANCE_CONNECTION_IMPORT_MINIMUM_VERSION },
  });
}
