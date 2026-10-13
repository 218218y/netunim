import path from 'node:path';
import { pathToFileURL } from 'node:url';

async function loadGlobals() {
  const offlineNodeModules = process.env.NETUNIM_OFFLINE_NODE_MODULES;
  if (offlineNodeModules) {
    const offlineGlobals = pathToFileURL(path.resolve(offlineNodeModules, 'globals', 'index.js')).href;
    return (await import(offlineGlobals)).default;
  }
  return (await import('globals')).default;
}

const globals = await loadGlobals();

const creditAdapterBoundaryFiles = [
  'netunim-kupa/bank-bridge/credit-core-values.mjs',
  'netunim-kupa/bank-bridge/credit-profile-model.mjs',
  'netunim-kupa/bank-bridge/credit-transaction-model.mjs',
  'netunim-kupa/bank-bridge/credit-failure-policy.mjs',
  'tests/credit_core*.mjs',
  'tests/credit_retired_exports.test.mjs',
  'tests/fixtures/checked-credit-core-values.mjs',
  'netunim-kupa/bank-bridge/credit-value-codec.mjs',
  'netunim-kupa/bank-bridge/credit-month-plan.mjs',
  'netunim-kupa/bank-bridge/credit-sync-scope.mjs',
  'netunim-kupa/bank-bridge/credit-http-policy.mjs',
  'netunim-kupa/bank-bridge/credit-http.mjs',
  'netunim-kupa/bank-bridge/credit-scheduler.mjs',
  'netunim-kupa/bank-bridge/visa-cal-model.mjs',
  'netunim-kupa/bank-bridge/credit-coverage.mjs',
  'netunim-kupa/bank-bridge/visa-cal-session.mjs',
  'netunim-kupa/bank-bridge/credit-adapter-base.mjs',
  'netunim-kupa/bank-bridge/visa-cal-adapter.mjs',
  'netunim-kupa/bank-bridge/max-model.mjs',
  'netunim-kupa/bank-bridge/credit-monthly-projection.mjs',
  'netunim-kupa/bank-bridge/max-adapter.mjs',
  'netunim-kupa/bank-bridge/isracard-group-adapter.mjs',
  'netunim-kupa/bank-bridge/credit-adapter-factory.mjs',
  'netunim-kupa/bank-bridge/credit-adapter-wire.mjs',
  'tests/credit_transport_boundary.test.mjs',
  'tests/credit_adapter*.mjs',
  'tests/fixtures/credit_adapter_runtime.mjs',
  'tests/credit_sync_scope.test.mjs',
  'tests/fixtures/checked-credit-sync-scope.mjs',
];

const financeDocumentBoundaryFiles = [
  'tests/orders_finance_document*.mjs',
  'tests/orders_finance_controller_fixture.mjs',
  'tests/fixtures/checked-finance-document-publication.mjs',
];

export default [
  {ignores:['.work/**','.offline/**','node_modules/**','**/data/**','**/backups/**','**/assets/vendor/**','**/document-bridge/pdfjs/**']},
  {
    files:[...creditAdapterBoundaryFiles,...financeDocumentBoundaryFiles,'netunim-kupa/bank-bridge/json-artifact-owner.mjs','netunim-kupa/bank-bridge/bridge-artifacts.mjs','netunim-kupa/bank-bridge/credit-diagnostic-model.mjs','netunim-kupa/bank-bridge/credit-diagnostic-log.mjs','tests/bank_artifact*.mjs','tests/fixtures/checked-bank-artifacts.mjs','netunim-kupa/bank-bridge/cheque-images.mjs','netunim-kupa/bank-bridge/file-task-owner.mjs','netunim-kupa/bank-bridge/browser-locator.mjs','netunim-kupa/bank-bridge/windows-browser.mjs','tests/bank_account_reader.test.mjs','tests/bank_browser_locator.test.mjs','tests/bank_local_cache.test.mjs','tests/bank_file_task_owner.test.mjs','tests/bank_image_shutdown_native.test.mjs','tests/bank_file_fixture.mjs','tests/bank_reader_fixture.mjs','tests/fixtures/checked-bank-reader-resources.mjs','netunim-kupa/bank-bridge/server.mjs','netunim-kupa/bank-bridge/provider-errors.mjs','netunim-kupa/bank-bridge/hapoalim-*.mjs','netunim-kupa/bank-bridge/credit-provider.mjs','netunim-kupa/bank-bridge/credit-session.mjs','netunim-kupa/bank-bridge/operation-owner.mjs','netunim-kupa/bank-bridge/shutdown-owner.mjs','netunim-kupa/bank-bridge/replacement-command.mjs','netunim-kupa/bank-bridge/loopback-port.mjs','netunim-kupa/bank-bridge/connection-*.mjs','netunim-kupa/bank-bridge/windows-platform.mjs','netunim-kupa/bank-bridge/http-*.mjs','netunim-kupa/bank-bridge/wire-errors.mjs','netunim-kupa/bank-bridge/finance-commands.mjs','netunim-kupa/bank-bridge/diagnostic-queries.mjs','tests/bank_configuration*.mjs','tests/bank_provider*.mjs','tests/bank_core*.mjs','tests/fixtures/checked-bank-model-codecs.mjs','tests/bank_session*.mjs','tests/credit_provider*.mjs','tests/fixtures/checked-bank-provider.mjs','tests/fixtures/bank_provider_runtime.mjs','tests/bank_operation_owner.test.mjs','tests/bank_shutdown*.mjs','tests/bank_replacement*.mjs','tests/bank_loopback_port.test.mjs','tests/bank_diagnostics_drain.test.mjs','tests/bank_stage_fixture.mjs','tests/fixtures/checked-bank-shutdown.mjs','tests/bank_connection_vault.test.mjs','tests/bank_bridge_packaging.test.mjs','tests/bank_provider_policy.test.mjs','tests/bank_bridge_http.test.mjs','tests/bank_bridge_boundaries.test.mjs','tests/bank_http_fixture.mjs','tests/bank_bridge_runtime.test.mjs','tests/bank_finance_commands.test.mjs','tests/fixtures/checked-bank-bridge-owner.mjs','tests/fixtures/checked-bank-bridge-routes.mjs'],
    languageOptions:{ecmaVersion:'latest',sourceType:'module',globals:globals.node},
    linterOptions:{noInlineConfig:true},
    rules:{'no-undef':'error','no-dupe-keys':'error','no-unreachable':'error','no-async-promise-executor':'error','no-unused-vars':['error',{args:'none',caughtErrors:'none',ignoreRestSiblings:true}]}
  },
  {
    // CAL session globals occur only in serialized browser callbacks.
    files:['netunim-kupa/bank-bridge/visa-cal-session.mjs'],
    languageOptions:{globals:{window:'readonly',navigator:'readonly',sessionStorage:'readonly'}}
  },
  {
    // These names occur inside serialized page.evaluate callbacks only.
    files:['netunim-kupa/bank-bridge/server.mjs','netunim-kupa/bank-bridge/hapoalim-login-runtime.mjs','netunim-kupa/bank-bridge/hapoalim-session.mjs','netunim-kupa/bank-bridge/cheque-images.mjs'],
    languageOptions:{globals:{window:'readonly',FileReader:'readonly'}}
  },
  {
    files:['netunim-orders/document-bridge/everything-*.mjs','netunim-orders/document-bridge/pdf-inventory.mjs','tests/everything_*.mjs','tests/pdf_inventory.test.mjs','tests/document_inventory_server.test.mjs','tests/fixtures/everything_json_process_worker.mjs','tests/fixtures/checked-pdf-inventory.mjs','netunim-orders/document-bridge/maintenance-process-*.mjs','tests/maintenance_process_*.mjs','tests/fixtures/maintenance_process_worker.mjs','tests/fixtures/checked-maintenance-process.mjs','netunim-orders/document-bridge/file-lock-*.mjs','tests/file_lock_*.mjs','tests/fixtures/file_lock_process_worker.mjs','tests/fixtures/checked-file-lock-owner.mjs','netunim-orders/document-bridge/http-*.mjs','netunim-orders/document-bridge/pdf-index-*.mjs','netunim-orders/document-bridge/preview-*.mjs','netunim-orders/document-bridge/native-preview-*.mjs','tests/pdf_index_*.mjs','tests/fixtures/checked-pdf-index-reader.mjs','tests/fixtures/checked-pdf-index-writer.mjs','tests/fixtures/pdf_index_write_process_worker.mjs','tests/document_preview_*.mjs','tests/fixtures/checked-preview-text-cache.mjs','tests/fixtures/checked-document-preview.mjs','tests/native_preview_*.mjs','tests/fixtures/checked-native-preview-session.mjs','tests/document_bridge_http.test.mjs','tests/document_bridge_packaging.test.mjs','tests/document_bridge_staging_fixture.mjs','tests/fixtures/checked-document-bridge-routes.mjs'],
    languageOptions:{ecmaVersion:'latest',sourceType:'module',globals:globals.node},
    linterOptions:{noInlineConfig:true},
    rules:{'no-undef':'error','no-dupe-keys':'error','no-unreachable':'error','no-async-promise-executor':'error',
      'no-unused-vars':['error',{args:'none',caughtErrors:'none'}]}
  },
  {
    files:['netunim-*/site/**/*.js','shared/**/*.js'],
    languageOptions:{ecmaVersion:'latest',sourceType:'module',globals:{...globals.browser,...globals.serviceworker}},
    linterOptions:{noInlineConfig:true},
    rules:{
      'no-undef':'error', 'no-dupe-args':'error', 'no-dupe-keys':'error',
      'no-unreachable':'error', 'no-fallthrough':'error', 'no-global-assign':'error',
      'no-import-assign':'error', 'no-async-promise-executor':'error',
      'no-eval':'error', 'no-new-func':'error', 'no-implied-eval':'error',
      'no-constant-binary-expression':'error'
      ,'no-unused-vars':['error',{args:'none',caughtErrors:'none',ignoreRestSiblings:true}]
    }
  }
];
