// Service-role only. Unique operation and invoice identities arbitrate all workers.
export function createExpenseLedger(admin, environment) {
  const table = () => admin.from('morning_expense_operations');
  const lookup = (owner, operation) => table().select('*').eq('owner_id', owner).eq('environment', environment).eq('operation_id', operation).maybeSingle();
  async function checked(query) { const {data, error} = await query; if (error) throw new Error('morning_expense_storage_failed'); return data; }
  return {
    get:(owner, operation) => checked(lookup(owner, operation)),
    recentCreated:owner => checked(table().select('operation_id,expense_id,payload,sent_at,verified_at')
      .eq('owner_id',owner).eq('environment',environment).eq('state','created')
      .order('sent_at',{ascending:false}).order('operation_id',{ascending:false}).limit(10)),
    pendingSources:(owner,page=0) => checked(table().select('*').eq('owner_id',owner).eq('environment',environment)
      .or('source_metadata.not.is.null,file_requested_at.not.is.null').is('source_verified_at',null).is('source_waived_at',null).neq('state','cancelled')
      .order('created_at',{ascending:false}).order('operation_id',{ascending:false}).range(page*20,page*20+19)),
    async reserve(row) {
      const {data, error} = await table().insert({...row, environment}).select('*').single();
      if (error?.code === '23505') return null;
      if (error) throw new Error('morning_expense_storage_failed');
      return data;
    },
    transition:(owner, operation, from, patch) => checked(table().update({...patch, updated_at:new Date().toISOString()}).eq('owner_id', owner)
      .eq('environment', environment).eq('operation_id', operation).eq('state', from).select('*').maybeSingle()),
    cancelReserved:(owner, operation) => checked(table().update({state:'cancelled', cancelled_at:new Date().toISOString(), updated_at:new Date().toISOString()})
      .eq('owner_id', owner).eq('environment', environment).eq('operation_id', operation).eq('state', 'reserved').is('sent_at', null).is('expense_id', null).select('*').maybeSingle()),
    fileTransition:(owner, row, patch) => {
      let query = table().update({...patch, updated_at:new Date().toISOString()}).eq('owner_id', owner).eq('environment', environment)
        .eq('operation_id', row.operation_id).eq('state', 'created').eq('file_state', row.file_state);
      query = row.file_generation ? query.eq('file_generation', row.file_generation) : query.is('file_generation', null);
      return checked(query.select('*').maybeSingle());
    },
  };
}
