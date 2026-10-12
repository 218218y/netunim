import {spawn} from 'node:child_process';

export function createMaintenanceProcessPlatform({executable, script, cwd, isHeld}) {
  return {isHeld,
    launch: () => spawn(executable, [script, '--refresh-pdf-index', '--force'], {cwd, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc']}),
    requestStop: child => new Promise((resolve, reject) => {
      if (!child.connected) { reject(Object.assign(new Error('PDF maintenance IPC is disconnected; await worker completion.'), {code: 'PDF_MAINTENANCE_IPC_DISCONNECTED'})); return; }
      child.send({type: 'stop-pdf-maintenance'}, error => error ? reject(error) : resolve());
    }),
  };
}

export function createMaintenanceWorkerPlatform({requestStop}) {
  return {requestStop,
    subscribe(listener) {
      if (process.send) process.on('message', listener);
      return () => { if (process.send) process.removeListener('message', listener); };
    },
    disconnect() { if (process.send && process.connected) process.disconnect(); },
  };
}
