import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const buildScript = fileURLToPath(new URL('../netunim-kupa/bank-bridge/build_bank_bridge_dpapi.ps1', import.meta.url));

export async function buildBankDpapi(directory) {
    await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', buildScript,
        '-OutputDirectory', directory], { windowsHide: true, timeout: 30000 });
}
