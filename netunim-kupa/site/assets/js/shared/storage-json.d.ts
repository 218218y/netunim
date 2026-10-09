// Data types only. The record constructors and ACK policy are checked from
// their JavaScript implementations; this declares no runtime function facade.
export type StorageJson = null | boolean | number | string | StorageJsonArray | StorageJsonObject;
export interface StorageJsonArray extends Array<StorageJson> {}
export interface StorageJsonObject { [key: string]: StorageJson }
