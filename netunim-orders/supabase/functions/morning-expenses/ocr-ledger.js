export function createOcrLedger(admin, environment) {
  const table = () => admin.from('morning_expense_ocr_operations');
  async function checked(query) {const {data,error} = await query; if (error) throw new Error('morning_ocr_storage_failed'); return data;}
  return {
    get:(owner, operation) => checked(table().select('*').eq('owner_id', owner).eq('environment', environment).eq('operation_id', operation).maybeSingle()),
    byFile:(owner, hash) => checked(table().select('*').eq('owner_id', owner).eq('environment', environment).eq('file_sha256', hash).maybeSingle()),
    hasFile:async hash => !!await checked(table().select('operation_id').eq('environment', environment).eq('file_sha256', hash).maybeSingle()),
    list:owner => checked(table().select('*').eq('owner_id', owner).eq('environment', environment).order('created_at', {ascending:false}).limit(20)),
    async reserve(row) {
      const {data,error} = await table().insert({...row,environment}).select('*').single();
      if (error?.code === '23505') return null;
      if (error) throw new Error('morning_ocr_storage_failed'); return data;
    },
    transition:(owner, row, patch) => checked(table().update({...patch, revision:row.revision + 1, updated_at:new Date().toISOString()})
      .eq('owner_id', owner).eq('environment', environment).eq('operation_id', row.operation_id).eq('revision', row.revision).select('*').maybeSingle()),
  };
}
