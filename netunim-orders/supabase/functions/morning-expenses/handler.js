const cors = {'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info, x-retry-count, traceparent, tracestate, baggage',
  'Access-Control-Allow-Methods':'POST, OPTIONS', 'Access-Control-Max-Age':'86400'};
export function createExpenseHandler({getUser, service}) {
  const json = (body, status) => Response.json(body, {status, headers:{...cors, 'Cache-Control':'no-store'}});
  return async request => {
    if (request.method === 'OPTIONS') return new Response('ok', {headers:cors});
    if (request.method !== 'POST') return json({ok:false, code:'method_not_allowed'}, 405);
    try {
      const token = request.headers.get('Authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1];
      const user = token ? await getUser(token) : null;
      if (!user?.id) return json({ok:false, code:'morning_expenses_auth_required', message:'נדרשת התחברות לענן.'}, 401);
      // Bound actual streamed bytes, not just a caller-controlled content-length.
      const params=new URL(request.url).searchParams,binary=params.get('action')==='upload_source';
      const contentType=request.headers.get('Content-Type')||'';
      if(binary&&!['application/pdf','image/jpeg','image/png'].includes(contentType))return json({ok:false,code:'invalid_expense_source'},400);
      const reader = request.body?.getReader();
      let size = 0, value = '';const chunks=[];
      if (reader) {
        const decoder = new TextDecoder();
        try {
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            size += part.value.byteLength;
            if (size > (binary?20971520:16384)) { await reader.cancel(); return json({ok:false, code:'request_too_large'}, 413); }
            if(binary)chunks.push(part.value);else value += decoder.decode(part.value, {stream:true});
          }
          value += decoder.decode();
        } finally { reader.releaseLock(); }
      }
      let body;
      try { body = binary?{action:'upload_source',operationId:params.get('operationId'),expectedEnvironment:params.get('expectedEnvironment'),
        retryGeneration:params.get('retryGeneration')||'',file:new Blob(chunks,{type:contentType})}:JSON.parse(value); } catch { return json({ok:false, code:'invalid_expense_input'}, 400); }
      const result = await service(user, body);
      return json(result.body, result.status);
    } catch { return json({ok:false, code:'morning_expenses_unavailable', message:'שירות ההוצאות אינו זמין כרגע.'}, 503); }
  };
}
