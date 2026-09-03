

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createDomainsRecordsCommands({model, saveState, saveChecksState, closeModal, confirmDialog}){
async function deleteRecord(collection,id){if(!await confirmDialog(collection==='checks'?'מחיקת צ׳ק':'מחיקת רשומה','למחוק את הרשומה? פעולה זו תישמר במקור הנתונים.',{confirmText:'מחק',cancelText:'ביטול',tone:'danger'}))return;model.state[collection]=model.state[collection].filter(x=>x.id!==id);closeModal(true);if(collection==='checks')saveChecksState('הצק נמחק',{deletedIds:[id]});else saveState('הרשומה נמחקה')}

return { deleteRecord };
}
