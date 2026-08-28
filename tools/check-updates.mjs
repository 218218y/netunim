import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const wranglerScript = fileURLToPath(new URL('./wrangler-version.mjs', import.meta.url));
const npmResult = spawnSync(npmCommand, ['outdated'], {
  cwd: repositoryRoot,
  stdio: 'inherit',
  shell: false,
});

if (npmResult.error) {
  console.error(`ERROR: could not run npm outdated: ${npmResult.error.message}`);
  process.exitCode = 1;
} else if (npmResult.status !== 0 && npmResult.status !== 1) {
  process.exitCode = npmResult.status ?? 1;
}

console.log('\nWrangler:');
const wranglerResult = spawnSync(process.execPath, [wranglerScript, '--check'], {
  stdio: 'inherit',
  shell: false,
});
if (wranglerResult.error) {
  console.error(`ERROR: could not check Wrangler: ${wranglerResult.error.message}`);
  process.exitCode = 1;
} else if (wranglerResult.status !== 0) {
  process.exitCode = wranglerResult.status ?? 1;
}
