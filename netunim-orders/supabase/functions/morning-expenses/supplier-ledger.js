export function createSupplierLedger(admin, environment) {
  const table=()=>admin.from('morning_supplier_operations');
  const identity=tax=>table().select('*').eq('environment',environment).eq('tax_id',tax).maybeSingle();
  async function checked(query){const {data,error}=await query;if(error)throw Error('morning_supplier_storage_failed');return data;}
  return {
    get:tax=>checked(identity(tax)),
    async reserve(owner,input){
      const {data,error}=await table().insert({environment,tax_id:input.taxId,owner_id:owner,name:input.name}).select('*').single();
      if(error?.code==='23505')return null;
      if(error)throw Error('morning_supplier_storage_failed');return data;
    },
    claim:tax=>checked(table().update({state:'sending',sent_at:new Date().toISOString()}).eq('environment',environment)
      .eq('tax_id',tax).eq('state','reserved').select('*').maybeSingle()),
    verify:(tax,id)=>checked(table().update({state:'verified',supplier_id:id,verified_at:new Date().toISOString()})
      .eq('environment',environment).eq('tax_id',tax).select('*').maybeSingle()),
  };
}
