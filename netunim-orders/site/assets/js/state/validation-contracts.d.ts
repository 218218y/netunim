export type EntityRow = Record<string,unknown> & {id:string};
export type OrderCollection = 'suppliers'|'transactions'|'customerDebts'|'customerOrders'|'serviceCalls'|'notes'|'inventoryItems'|'inventoryEvents'|'warehouseOrders';
export type NotesWorkbook = Record<string,unknown> & {
  sheets:(EntityRow & {name:string})[],columns:(EntityRow & {sheetId:string})[],rows:(EntityRow & {sheetId:string})[],
};
// Only the fields proven by the runtime guard are specified. No debt amount,
// supplier metadata or arbitrary cloud JSON is certified by this document type.
export type OrderCloudState = Record<string,unknown> & Record<OrderCollection,EntityRow[]> & {inventoryCategoryOrder:unknown[],notesSheet?:NotesWorkbook|undefined};
export type RestoreCountInput = Partial<Record<OrderCollection|'checks',{length:number}|null|undefined>> & {notesSheet?:{sheets?:{length:number}|null|undefined,rows?:{length:number}|null|undefined}|null|undefined};
