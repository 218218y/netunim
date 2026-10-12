import { createConnection } from 'node:net';
// HTTP timeouts and lost responses say nothing about listener closure. Only a
// refused loopback TCP connection certifies absence; other failures stay errors.
export function isLoopbackPortClosed({ host, port, timeoutMs = 400 }) {
    return new Promise((resolve, reject) => {
        const socket = createConnection({ host, port });
        let settled = false;
        const finish = (error, closed) => {
            if (settled)
                return;
            settled = true;
            socket.destroy();
            if (error)
                reject(error);
            else
                resolve(closed);
        };
        socket.once('connect', () => finish(null, false));
        socket.once('error', error => error.code === 'ECONNREFUSED' ? finish(null, true) : finish(error));
        socket.setTimeout(timeoutMs, () => finish(Object.assign(new Error('Loopback listener probe timed out'), { code: 'BRIDGE_PORT_PROBE_TIMEOUT' })));
    });
}
