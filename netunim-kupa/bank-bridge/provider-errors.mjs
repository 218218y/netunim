// @ts-check
/** @typedef {Error & {stage?:unknown,code?:unknown}} ProviderError */
/** @param {string} stage @param {unknown} error @param {string} [code] */
export function stageError(stage, error, code = 'BANK_DATA_ERROR') {
    const e = /** @type {ProviderError} */ (error instanceof Error ? error : new Error(String(error || 'שגיאה לא ידועה')));
    if (!e.stage)
        e.stage = stage;
    if (!e.code)
        e.code = code;
    return e;
}
/** @template T @param {string} stage @param {()=>T|PromiseLike<T>} fn @param {string} [code] @returns {Promise<T>} */
export async function runStage(stage, fn, code) {
    try {
        return await fn();
    }
    catch (e) {
        throw stageError(stage, e, code);
    }
}
