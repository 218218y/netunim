import {supabaseConfig} from '../supabase/config.js';
import {mountAccountSecurity} from './js/shared/account-security-page.js';
mountAccountSecurity(document.getElementById('accountSecurity'),supabaseConfig);

import {mountBridgePairing} from './js/shared/bridge-pairing-page.js';
import {createFinanceBridgeIntegration} from './js/integrations/bank-bridge.js';
import {createDocumentBridgeIntegration} from './js/integrations/document-bridge.js';

const bank = createFinanceBridgeIntegration();
const documents = createDocumentBridgeIntegration();
mountBridgePairing(document.getElementById('bridgePairing'), {
  bank: {get: bank.getBridgeToken, set: bank.setBridgeToken},
  documentBridge: {get: documents.getToken, set: documents.setToken},
});
