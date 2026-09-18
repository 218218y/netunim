export function createServiceActionPorts({bulk,view,editor}){
  return {
    toggleServiceBulkMode:(...args)=>bulk.toggleServiceBulkMode(...args),
    toggleServiceBulkRow:(...args)=>bulk.toggleServiceBulkRow(...args),
    toggleServiceBulkVisible:(...args)=>bulk.toggleServiceBulkVisible(...args),
    deleteSelectedServiceCalls:(...args)=>bulk.deleteSelectedServiceCalls(...args),
    renderService:(...args)=>view.renderService(...args),
    openServiceGmail:(...args)=>view.openServiceGmail(...args),
    toggleServiceFlag:(...args)=>view.toggleServiceFlag(...args),
    openServiceModal:(...args)=>editor.openServiceModal(...args),
    saveService:(...args)=>editor.saveService(...args),
    deleteService:(...args)=>editor.deleteService(...args),
  };
}
