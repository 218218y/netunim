import {createNativePreviewSession} from '../../netunim-orders/document-bridge/native-preview-session.mjs';
/** @type {import('../../netunim-orders/document-bridge/native-preview-session.mjs').PreviewChild} */
const child = {pid: 12, killed: false, exitCode: null,
  stdin: {writable: true, write: () => {}},
  stdout: {setEncoding: () => {}, on: () => {}, removeListener: () => {}},
  stderr: {setEncoding: () => {}, on: () => {}, removeListener: () => {}},
  on: () => {}, removeListener: () => {}};
/** @type {import('../../netunim-orders/document-bridge/native-preview-session.mjs').PreviewSessionPorts} */
const ports = {host: {prepare: async () => {}, launch: () => child, terminate: async () => {}},
  timers: {setTimeout: () => 1, clearTimeout: () => {}}, log: async () => {}};
const session = createNativePreviewSession(ports);
session.command('OPEN', ['encoded-path', 1, 2, 300, 200]);
// @ts-expect-error command arguments must be protocol scalars, not a mutable app context
session.command('OPEN', [{owner: 'account'}]);
// @ts-expect-error command deadline is measured in numeric milliseconds
session.command('OPEN', [], '6000');
// @ts-expect-error termination must confirm asynchronously; a boolean is not a stopped process
createNativePreviewSession({...ports, host: {...ports.host, terminate: () => true}});
// @ts-expect-error launching must return concrete stream/command lifecycle ports
createNativePreviewSession({...ports, host: {...ports.host, launch: () => ({pid: 1})}});
