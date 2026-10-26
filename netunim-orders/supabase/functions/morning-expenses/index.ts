import {createClient} from 'npm:@supabase/supabase-js@2.112.4';
import {createExpenseTransport} from './transport.js';
import {createExpenseService} from './service.js';
import {createExpenseHandler} from './handler.js';
import {createExpenseLedger} from './ledger.js';
import {createExpenseWriter} from './writer.js';
import {createExpenseUpload} from './upload.js';
import {expenseConfiguration} from './configuration.js';

function envKey(jsonName:string, legacyName:string) {
  try { const values = JSON.parse(Deno.env.get(jsonName) || '{}'); const key = values.default || Object.values(values).find(value => typeof value === 'string' && value); if (key) return String(key); } catch { /* legacy key */ }
  return Deno.env.get(legacyName) || '';
}
const configuration = expenseConfiguration((name:string) => Deno.env.get(name));
const {environment, clientId, clientSecret, valid} = configuration;
const url = Deno.env.get('SUPABASE_URL') || '', key = envKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY');
const request = valid ? createExpenseTransport({environment, clientId, clientSecret}) : async () => { throw new Error('morning_environment_invalid'); };
const secret = envKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY');
const admin = url && secret ? createClient(url, secret, {auth:{persistSession:false, autoRefreshToken:false}}) : null;
const writer = admin ? createExpenseWriter({request, environment, ledger:createExpenseLedger(admin, environment),
  enabled:configuration.writes, pcnP:configuration.pcnP, productionUserId:configuration.productionUserId,
  writeIds:() => Deno.env.get('MORNING_EXPENSE_WRITE_USER_IDS') || '', pSuppliers:() => configuration.pSuppliers,
}) : null;
const uploader = admin ? createExpenseUpload({request, environment, ledger:createExpenseLedger(admin, environment),
  enabled:configuration.uploads, productionUserId:configuration.productionUserId, writeIds:() => Deno.env.get('MORNING_EXPENSE_WRITE_USER_IDS') || '',
}) : null;
const service = createExpenseService({request, environment, readIds:() => Deno.env.get('MORNING_EXPENSE_READ_USER_IDS') || '', writer, uploader});
Deno.serve(createExpenseHandler({
  getUser:async (token:string) => {
    if (!url || !key || !valid || !clientId || !clientSecret) throw new Error('morning_expenses_not_configured');
    const client = createClient(url, key, {auth:{persistSession:false, autoRefreshToken:false}, global:{headers:{Authorization:`Bearer ${token}`}}});
    const {data, error} = await client.auth.getUser(token);
    return error ? null : data.user;
  }, service,
}));
