import { createDomainsCreditController } from '../netunim-kupa/site/assets/js/domains/credit/controller.js';
import { createCreditConnectionOwner } from '../netunim-kupa/site/assets/js/domains/credit/connection-owner.js';
import {
  normalizeCreditSync,
  CREDIT_CONNECTOR_CONTRACT_VERSION,
} from '../netunim-kupa/site/assets/js/domains/credit/sync-feed.js';

// Old test inputs map to real owners. No production compatibility constructor or
// synthetic data/profile/IO implementation is introduced by this test helper.
export function createKupaCreditControllerFixture(ports) {
  const connections = createCreditConnectionOwner({
    protocol: { minimumBridgeVersion: 73, contractVersion: CREDIT_CONNECTOR_CONTRACT_VERSION },
    pairing: { token: () => ports.bridge.getBridgeToken() },
    transport: {
      readStatus: () => ports.bridge.creditStatus(),
      readDiagnostics: () => ports.bridge.creditDiagnostics(),
      readData: () => ports.bridge.creditDataDiagnostics(),
      saveProfile: (payload) => ports.bridge.saveCreditProfile(payload),
      deleteProfile: (profileId) => ports.bridge.deleteCreditProfile(profileId),
    },
    effects: ports.effects,
    profiles: { read: () => normalizeCreditSync(ports.model.state.creditSync).profiles },
    presentation: {
      toast: (...args) => ports.toast(...args),
      render: (...args) => ports.render(...args),
      confirmDialog: (...args) => ports.confirmDialog(...args),
    },
  });
  const controller = createDomainsCreditController({ ...ports, connections });
  const runtime = controller.runtime;
  controller.runtime = {
    isPending: () => runtime.isPending() || connections.runtime.isPending(),
    async drain() {
      await Promise.all([runtime.drain(), connections.runtime.drain()]);
    },
    dispose() {
      connections.runtime.dispose();
      return runtime.dispose();
    },
  };
  return controller;
}
