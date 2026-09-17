import {clone} from '../core/values.js';

export function comparableBackupData(payload){const x=clone(payload||{});if(x&&typeof x==='object')delete x._meta;return JSON.stringify(x,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,value[key]])):value)}

export function prepareStateData(state,source=state){const x=clone(source);x.version=4;x._meta={...(x._meta||{}),format:'order-management-portable',schemaVersion:4,savedAt:new Date().toISOString(),app:"ניהול הזמנות ניידת · צ'קים משותפים"};return x}
