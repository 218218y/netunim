import vm from 'node:vm';
import path from 'node:path';
import {createEverythingDiscovery} from '../netunim-orders/document-bridge/everything-discovery.mjs';
import {createEverythingDiscoveryPlatform} from '../netunim-orders/document-bridge/everything-process-platform.mjs';
import {parseRegistryInstallLocation} from '../netunim-orders/document-bridge/lib.mjs';
import {baseline,plain} from './everything_session_fixture.mjs';
const names=['whereEs','registryValue','executableNamesForLocation','findEverythingExecutable'];
const script=new vm.Script("let cachedEsPath='';\n"+names.map(name=>baseline.functions[name].source).join('\n')+'\n({es:whereEs,executable:findEverythingExecutable})');
export function discoveryFixture(version='current',options={}){
 const root='synthetic-root',env=options.env||{},platform=options.platform||'win32',checks=[],calls=[];
 const existsFile=async file=>{checks.push(file);return options.exists?options.exists(file):false};
 const execute=async(file,args,opts)=>{calls.push([file,args,opts]);if(file==='reg.exe')return{stdout:`InstallLocation REG_SZ ${options.registry||'C:\\registered'}\n`};if(options.whereError)throw new Error('missing command');return {stdout:(options.where||['C:\\from-path.exe','C:\\secondary.exe']).join('\r\n')}};
 const processes={command:(file,args,timeout)=>execute(file,args,{encoding:'utf8',windowsHide:true,timeout})};
 const ports=createEverythingDiscoveryPlatform({root,env,platform,processes});ports.files.exists=existsFile;
 const owner=version==='baseline'?script.runInNewContext({path,process:{env,platform},TOOL_ES:path.join(root,'tools','es.exe'),existsFile,execFile:execute,parseRegistryInstallLocation}):createEverythingDiscovery(ports);
 return {owner,ports,checks,calls,observation:()=>plain({checks,calls})};
}
export const config={everythingInstance:'',everythingExecutable:'C:\\configured.exe',searchTimeoutMs:15000,allowedOrigins:[]};
