

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createDomainsRecordsCommands({model, saveState, saveChecksState, closeModal, confirmDialog, renderCollection}){
async function deleteRecord(collection,id){if(!await confirmDialog(collection==='checks'?'מחיקת צ׳ק':'מחיקת רשומה','למחוק את הרשומה? פעולה זו תישמר במקור הנתונים.',{confirmText:'מחק',cancelText:'ביטול',tone:'danger'}))return false;model.state[collection]=model.state[collection].filter(x=>x.id!==id);closeModal(true);const operations=[{type:'delete',collection,id}];if(collection==='checks')saveChecksState('הצק נמחק',{deletedIds:[id],mutationType:'delete',surface:'kupa.delete.checks',operations});else{saveState('הרשומה נמחקה',{deleteIntents:{[collection]:[id]},mutationType:'delete',surface:`kupa.delete.${collection}`,domains:[collection],operations})}renderCollection(collection);return true}

return { deleteRecord };
}
