// Every call is pinned to the account captured before asynchronous auth refresh.
export function createExpenseRequest({supaFetch}) {
  return async (action, payload, assertCurrent, {signal} = {}) => {
    const check = () => { signal?.throwIfAborted(); assertCurrent(); };
    check();
    try {
      const binary=action==='upload_source';
      const query=binary?'?'+new URLSearchParams({action,operationId:payload.operationId,expectedEnvironment:payload.expectedEnvironment,
        ...(payload.retryGeneration?{retryGeneration:payload.retryGeneration}:{})}):'';
      const response = await supaFetch('/functions/v1/morning-expenses'+query, {method:'POST', networkRetry:false, dataPriority:'high',
        assertRequestScope:check, ...(binary?{body:payload.file,headers:{'Content-Type':payload.file.type},networkTimeoutMs:90000}:
          {body:JSON.stringify({...payload, action})}), ...(signal ? {signal} : {})});
      check();
      const data = await response.json(); check();
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('תשובת שירות ההוצאות אינה תקינה.');
      if (!response.ok || data.ok !== true) throw Object.assign(new Error(data.message || 'לא ניתן להשלים את הפעולה ב־Morning.'), {code:data.code, status:response.status, details:data});
      return data;
    } catch (error) { check(); throw error; }
  };
}
