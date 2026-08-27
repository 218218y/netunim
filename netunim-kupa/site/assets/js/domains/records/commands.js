

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createDomainsRecordsCommands({model, saveState, saveChecksState, closeModal}){
function deleteRecord(collection,id){if(!confirm('למחוק את הרשומה?'))return;model.state[collection]=model.state[collection].filter(x=>x.id!==id);closeModal(true);if(collection==='checks')saveChecksState('הצק נמחק');else saveState('הרשומה נמחקה')}

return { deleteRecord };
}
