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

export default [
  {ignores:['.work/**','.offline/**','node_modules/**','**/data/**','**/backups/**','**/assets/vendor/**','**/document-bridge/pdfjs/**']},
  {
    files:['netunim-orders/document-bridge/maintenance-process-*.mjs','tests/maintenance_process_*.mjs','tests/fixtures/maintenance_process_worker.mjs','tests/fixtures/checked-maintenance-process.mjs','netunim-orders/document-bridge/file-lock-*.mjs','tests/file_lock_*.mjs','tests/fixtures/file_lock_process_worker.mjs','tests/fixtures/checked-file-lock-owner.mjs','netunim-orders/document-bridge/http-*.mjs','netunim-orders/document-bridge/pdf-index-reader.mjs','netunim-orders/document-bridge/pdf-index-file-platform.mjs','netunim-orders/document-bridge/preview-*.mjs','netunim-orders/document-bridge/native-preview-*.mjs','tests/pdf_index_*.mjs','tests/fixtures/checked-pdf-index-reader.mjs','tests/document_preview_*.mjs','tests/fixtures/checked-preview-text-cache.mjs','tests/fixtures/checked-document-preview.mjs','tests/native_preview_*.mjs','tests/fixtures/checked-native-preview-session.mjs','tests/document_bridge_http.test.mjs','tests/document_bridge_packaging.test.mjs','tests/fixtures/checked-document-bridge-routes.mjs'],
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
