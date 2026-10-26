import {createClient} from 'npm:@supabase/supabase-js@2.112.4';
import {createExpenseTransport} from './transport.js';
import {createExpenseService} from './service.js';
import {createExpenseHandler} from './handler.js';

function envKey(jsonName:string, legacyName:string) {
  try { const values = JSON.parse(Deno.env.get(jsonName) || '{}'); const key = values.default || Object.values(values).find(value => typeof value === 'string' && value); if (key) return String(key); } catch { /* legacy key */ }
  return Deno.env.get(legacyName) || '';
}
const environment = (Deno.env.get('MORNING_ENV') || 'production').trim().toLowerCase();
const url = Deno.env.get('SUPABASE_URL') || '', key = envKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY');
const valid = ['production', 'sandbox'].includes(environment);
const request = valid ? createExpenseTransport({environment, clientId:Deno.env.get('MORNING_CLIENT_ID') || '', clientSecret:Deno.env.get('MORNING_CLIENT_SECRET') || ''}) : async () => { throw new Error('morning_environment_invalid'); };
const service = createExpenseService({request, environment, readIds:() => Deno.env.get('MORNING_EXPENSE_READ_USER_IDS') || ''});
Deno.serve(createExpenseHandler({
  getUser:async (token:string) => {
    if (!url || !key || !valid) throw new Error('morning_expenses_not_configured');
    const client = createClient(url, key, {auth:{persistSession:false, autoRefreshToken:false}, global:{headers:{Authorization:`Bearer ${token}`}}});
    const {data, error} = await client.auth.getUser(token);
    return error ? null : data.user;
  }, service,
}));
