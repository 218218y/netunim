import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// The offline installer supplies its content-addressed modules directory.
// This checker emits nothing and uses the same locked compiler in both modes.
const root=fileURLToPath(new URL('../',import.meta.url));
const modules=process.env.NETUNIM_OFFLINE_NODE_MODULES||path.join(root,'node_modules');
const result=spawnSync(process.execPath,[path.join(modules,'typescript/bin/tsc'),
  '--project',path.join(root,'tsconfig.contracts.json'),'--pretty','false'],{cwd:root,stdio:'inherit'});
if(result.error)console.error(result.error);
process.exitCode=result.status??1;
