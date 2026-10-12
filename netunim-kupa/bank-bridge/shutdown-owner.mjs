// @ts-check
/**
 * @typedef {{close:()=>boolean,drain:()=>Promise<void>}} AcceptedOperations
 * @typedef {{drain:()=>Promise<void>}} DiagnosticDrain
 * @typedef {{schedule:(run:()=>void,delayMs:number)=>()=>void,
 * subscribeStop:(listener:()=>void)=>()=>void,closeListener:()=>Promise<void>,
 * exit:()=>void,reportError:(error:unknown)=>void}} ShutdownPlatform
 */
/**
 * Admission closes immediately after the HTTP acknowledgement (or a signal).
 * The listener stays visible until accepted work and diagnostic writes settle.
 * A failed drain never certifies exit; a later request can retry teardown.
 * Constructing this owner creates no listener, subscription or timer.
 * @param {{operations:AcceptedOperations,diagnostics:DiagnosticDrain,platform:ShutdownPlatform}} ports
 */
export function createBridgeShutdownOwner({ operations, diagnostics, platform }) {
    let started = false, stopping = false, completed = false;
    /** @type {Promise<void>|null} */ let running = null;
    /** @type {(()=>void)|null} */ let releaseStop = null;
    /** @type {(()=>void)|null} */ let cancelWakeup = null;
    function request() {
        if (completed)
            return Promise.resolve();
        if (running)
            return running;
        stopping = true;
        operations.close();
        const waiting = new Promise(resolve => {
            cancelWakeup = platform.schedule(() => { cancelWakeup = null; resolve(undefined); }, 50);
        });
        const task = waiting.then(async () => {
            await operations.drain();
            // Providers may append diagnostics during their final cleanup. Join the
            // logger only after every accepted provider/configuration obligation.
            await diagnostics.drain();
            await platform.closeListener();
            releaseStop?.();
            releaseStop = null;
            completed = true;
            platform.exit();
        });
        running = task;
        void task.then(() => {
            if (running === task)
                running = null;
        }, error => {
            if (running === task)
                running = null;
            cancelWakeup?.();
            cancelWakeup = null;
            platform.reportError(error);
        });
        return task;
    }
    function start() {
        if (started || stopping)
            return false;
        releaseStop = platform.subscribeStop(() => { void request(); });
        started = true;
        return true;
    }
    async function drain() { if (running)
        await running; }
    return Object.freeze({ start, request, drain, isStopping: () => stopping });
}
