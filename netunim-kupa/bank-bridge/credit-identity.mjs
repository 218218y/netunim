import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

function loginIdentity(profile){const provider=String(profile?.provider||'');return provider==='visaCal'||provider==='max'?String(profile?.credentials?.username||'').trim().toLowerCase():String(profile?.credentials?.id||'').replace(/\D/g,'')}
export function creditIdentityDirectory(root,profile){const provider=String(profile?.provider||''),identity=loginIdentity(profile);if(!provider||!identity)return '';const digest=createHash('sha256').update(`${provider}\0${identity}`).digest('hex').slice(0,32);return path.join(path.resolve(root),`${provider}-${digest}`)}
function assertChild(root,target){const base=path.resolve(root),resolved=path.resolve(target);if(!resolved.startsWith(`${base}${path.sep}`))throw Object.assign(new Error('נתיב זהות הדפדפן אינו נמצא תחת תיקיית הזהויות המקומית'),{code:'CREDIT_IDENTITY_PATH_INVALID'});return resolved}
export async function deleteCreditIdentity(root,profile){const directory=creditIdentityDirectory(root,profile);if(!directory)return false;await fs.rm(assertChild(root,directory),{recursive:true,force:true});return true}
export async function resetCreditIdentities(root){const resolved=path.resolve(root);if(path.basename(resolved)!=='credit-identities')throw Object.assign(new Error('איפוס זהויות אשראי הוגבל לתיקיית credit-identities בלבד'),{code:'CREDIT_IDENTITY_PATH_INVALID'});await fs.rm(resolved,{recursive:true,force:true})}
