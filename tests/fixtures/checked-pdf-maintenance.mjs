import {createPdfMaintenanceOperation,decodePdfMaintenanceRecord} from '../../netunim-orders/document-bridge/pdf-maintenance-operation.mjs';
/** @type {import('../../netunim-orders/document-bridge/pdf-maintenance-operation.mjs').MaintenancePorts} */
const ports={index:{load:async()=>{},entries:new Map(),view:()=>({pending:0,pdfCount:0}),publishPending:()=>{},append:async()=>{},serialize:entry=>({...entry}),compact:async()=>{}},inventory:{rebuild:async()=>({pdfCount:0,changed:0,removed:0,rows:[]})},extraction:{read:async()=>({hasForm:false,text:'',formFields:[],formFieldCount:0}),stat:async()=>null,fields:()=>[]},metadata:{read:async()=>({}),write:async()=>{}},policy:{limits:{PDF_FORM_MAINTENANCE_MAX_FILES:300,PDF_FORM_MAINTENANCE_MAX_MS:0,PDF_FORM_MAINTENANCE_INTERVAL_MS:72000000,PDF_FORM_RECONCILE_INTERVAL_MS:72000000,PDF_FORM_RETRY_MS:86400000,PDF_FORM_MAX_BYTES:100000,PDF_FORM_DETECTION_REVISION:2,PDF_FORM_SEARCH_TEXT_REVISION:2,PDF_FORM_GEOMETRY_REVISION:1},plan:()=>({full:true,modifiedSince:''})},runtime:{now:Date.now,cpuUsage:()=>({user:0,system:0}),isStopping:()=>false,setTimeout:()=>({}),clearTimeout:()=>{}},audit:{write:async()=>{}}};
const operation=createPdfMaintenanceOperation(ports);operation.refresh({force:true,maxChanged:Infinity});operation.stop();
/** @type {Promise<void>} */const disposed=operation.dispose();void disposed;
// @ts-expect-error checkpoint values are decoded before being treated as text
const invalidTimestamp=decodePdfMaintenanceRecord(/** @type {unknown} */({})).lastAttemptAt*1000;void invalidTimestamp;
// @ts-expect-error an extracted result must report boolean form presence
createPdfMaintenanceOperation({...ports,extraction:{...ports.extraction,read:async()=>({hasForm:'yes',text:'',formFields:[],formFieldCount:0})}});
// @ts-expect-error inventory admission requires actual rows for the selected batch
createPdfMaintenanceOperation({...ports,inventory:{rebuild:async()=>({pdfCount:1,changed:1,removed:0})}});
// @ts-expect-error publication of pending counts is synchronous
createPdfMaintenanceOperation({...ports,index:{...ports.index,view:async()=>({pending:0,pdfCount:0})}});
// @ts-expect-error work limits are numeric
operation.refresh({maxChanged:'all'});
// @ts-expect-error operation cannot delete document files
operation.delete('C:\\synthetic.pdf');
