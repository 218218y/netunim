export function createContexts(){
return {
  model:{
    state:null
  },
  ui:{
    currentView:'supplier',
    checkTab:'open',
    checkYear:'all',
    checkSearchValue:'',
    summarySupplierYearView:'current',
    scrollViewportMemory:new Map(),
    checksBulkMode:false,
    checksBulkSelected:new Set(),
    pendingJsonRestore:null
  },
  supplierUi:{
    currentSupplierId:null,
    filterMode:'all',
    searchText:'',
    supplierYearView:'current',
    supplierOrderDraft:[],
    supplierViewportMemory:new Map(),
    supplierBulkMode:false,
    supplierBulkSelected:new Set(),
    supplierMoveTargetId:null
  },
  customerUi:{
    customerTab:'debts',
    customerFilter:'all',
    customerOrderFilter:'all',
    customerSearch:'',
    customerBulkMode:false,
    customerBulkSelected:new Set()
  },
  serviceUi:{
    serviceFilter:'all',
    serviceSearch:'',
    serviceBulkMode:false,
    serviceBulkSelected:new Set()
  },
  warehouseUi:{
    warehouseTab:'stock',
    warehouseSearch:'',
    inventoryCategoryOrderDraft:[],
    warehouseBulkMode:false,
    warehouseBulkSelected:new Set(),
    inventoryCategoryOpen:new Set(),
    inventoryLocationOpen:new Set()
  },
  notesUi:{
    notesBulkMode:false,
    notesBulkSelected:new Set()
  },
  calendarUi:{
    viewMode:'month',
    focusDate:'',
    calendars:[],
    events:[],
    displayEvents:[],
    pending:[],
    eventMap:new Map(),
    cacheFetchedAt:null
  },
  calendarSession:{
    accessToken:'',
    tokenExpiresAt:0,
    connected:false,
    accountVerified:false,
    accountId:'',
    syncing:false,
    syncPromise:null,
    lastSyncAt:null,
    lastError:'',
    pollTimer:null
  },
  files:{
    dirHandle:null,
    dirPermission:'unknown',
    folderLastError:'',
    folderWritePrepared:false,
    folderWritePending:false,
    folderForceBackupPending:false,
    folderWritePromise:null,
    browserStatePendingPayload:null,
    browserStateWritePromise:null,
    autoBackupTimer:null,
    pendingAutoBackupPayload:null
  },
  tab:{
    primaryTab:true,
    primaryTabReady:false,
    primaryLockRelease:null
  },
  session:{
    lastCloudState:null,
    cloudRevision:0,
    cloudUpdatedAt:null,
    cloudBusy:false,
    cloudPollTimer:null,
    saveTimer:null,
    localGeneration:0,
    cloudSaveRequested:false,
    cloudSavePromise:null,
    cloudSaveMessage:'',
    cloudConflictBlocked:false
  },
  checksSession:{
    checksGeneration:0,
    checksCloudRevision:0,
    checksCloudUpdatedAt:null,
    checksCloudBase:null,
    checksBankEvents:null,
    checksCloudBusy:false,
    checksCloudLastError:'',
    checksSaveRequested:false,
    checksSavePromise:null,
    checksSaveMessage:'',
    kupaNetReadout:null,
    kupaCloudReadState:null,
    kupaReadRevision:0,
    sharedChecksSaveTimer:null,
    sharedChecksSaveMessage:''
  }
};
}
