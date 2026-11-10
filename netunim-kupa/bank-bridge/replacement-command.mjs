// @ts-check
/** @typedef {{response:{ok:boolean},data:{service?:unknown,ok?:unknown,code?:unknown,version?:unknown,creditContractVersion?:unknown,pairingProtocol?:unknown,installationId?:unknown}}} LoopbackResponse
 * @typedef {{probe:()=>Promise<LoopbackResponse|null>,readToken:(health:LoopbackResponse)=>Promise<string>,
 * shutdown:(token:string)=>Promise<LoopbackResponse>,waitUntilStopped:()=>Promise<boolean>}} ReplacementPorts */
/**
 * An acknowledgement is a request to drain, not permission to force-kill after
 * a timeout. An unknown response cannot prove provider/vault work has settled.
 * No PID/kill capability is accepted by this command.
 * @param {ReplacementPorts} ports
 */
export function createBridgeReplacementCommand({ probe, readToken, shutdown, waitUntilStopped }) {
    const failure = (/** @type {string} */ code, /** @type {string} */ message) => Object.assign(new Error(message), { code });
    /** @param {{version:number,creditContractVersion:number,installationId:string}} expected */
    async function check(expected) {
        if (!expected.installationId)
            throw failure('INSTALLATION_ID_MISSING', 'The staged Bank Bridge installation ID is missing or invalid. Rerun the installer.');
        const health = await probe();
        const data = health?.data;
        if (!health?.response.ok || data?.ok !== true || data.service !== 'netunim-kupa-bank-bridge' ||
            data.version !== expected.version || data.creditContractVersion !== expected.creditContractVersion)
            throw failure('HEALTHCHECK_FAILED', 'The expected Bank Bridge service/version did not respond on the local port.');
        if (data.pairingProtocol !== 1 || data.installationId !== expected.installationId)
            throw failure('INSTALLATION_MISMATCH', 'The running Bank Bridge does not match this installation or lacks scoped pairing. An older instance may still be running.');
    }
    async function stop() {
        let health;
        try {
            health = await probe();
        }
        catch {
            throw failure('BRIDGE_PROBE_UNCONFIRMED', 'Bank Bridge listener state could not be confirmed. Wait for existing work to finish and retry; its runtime was not replaced.');
        }
        if (health === null)
            return;
        if (health.data.service !== 'netunim-kupa-bank-bridge')
            throw failure('BRIDGE_PORT_OCCUPIED', 'Bank Bridge port is occupied by another local service');
        let token = '';
        try {
            token = (await readToken(health)).trim();
        }
        catch { }
        if (!token)
            throw failure('BRIDGE_AUTH_REQUIRED', 'The existing Bank Bridge cannot be authenticated. Close it normally before retrying the installation.');
        let result;
        try {
            result = await shutdown(token);
        }
        catch {
            throw failure('BRIDGE_SHUTDOWN_UNCONFIRMED', 'Bank Bridge shutdown could not be confirmed. Wait for existing work to finish and retry; the process was not force-stopped.');
        }
        if (!result.response.ok || result.data.ok !== true)
            throw failure('BRIDGE_SHUTDOWN_REJECTED', 'The existing Bank Bridge rejected shutdown. Close it normally before retrying the installation.');
        let stopped;
        try {
            stopped = await waitUntilStopped();
        }
        catch {
            throw failure('BRIDGE_SHUTDOWN_UNCONFIRMED', 'Bank Bridge listener closure could not be confirmed. Retry after it stops; its runtime was not replaced.');
        }
        if (!stopped)
            throw failure('BRIDGE_SHUTDOWN_PENDING', 'Bank Bridge is still finishing accepted work. Retry the installation after it stops; the process was not force-stopped.');
    }
    return Object.freeze({ stop, check });
}
