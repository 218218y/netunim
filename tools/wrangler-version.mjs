import { fileURLToPath } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';

const VERSION_FILE = new URL('./wrangler-version.txt', import.meta.url);
const VERSION_PATH = fileURLToPath(VERSION_FILE);
const REGISTRY_URL = 'https://registry.npmjs.org/wrangler/latest';
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function parseArgs(argv) {
  return {
    check: argv.includes('--check'),
    update: argv.includes('--update'),
    allowMajor: argv.includes('--allow-major'),
    print: argv.includes('--print'),
  };
}

function major(version) {
  return Number(version.split('.')[0]);
}

async function readConfiguredVersion() {
  const version = (await readFile(VERSION_PATH, 'utf8')).trim();
  if (!VERSION_RE.test(version)) {
    throw new Error(`Invalid Wrangler version in ${VERSION_PATH}: ${JSON.stringify(version)}`);
  }
  return version;
}

async function fetchLatestVersion() {
  const response = await fetch(REGISTRY_URL, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    throw new Error(`npm registry returned HTTP ${response.status}`);
  }
  const data = await response.json();
  const version = String(data?.version ?? '').trim();
  if (!VERSION_RE.test(version)) {
    throw new Error(`npm registry returned an invalid Wrangler version: ${JSON.stringify(version)}`);
  }
  return version;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const configured = await readConfiguredVersion();

  if (args.print) {
    console.log(configured);
    return;
  }
  if (!args.check && !args.update) {
    throw new Error('Use --check, --update, or --print.');
  }

  const latest = await fetchLatestVersion();
  console.log(`Configured Wrangler: ${configured}`);
  console.log(`Latest Wrangler:     ${latest}`);

  if (!args.update) {
    console.log(configured === latest ? 'Wrangler is up to date.' : 'Wrangler update is available.');
    return;
  }

  if (configured === latest) {
    console.log('No Wrangler update is needed.');
    return;
  }

  if (!args.allowMajor && major(configured) !== major(latest)) {
    throw new Error(
      `Refusing automatic major upgrade ${configured} -> ${latest}. ` +
      'Review the Wrangler release notes, then run npm run wrangler:update-major explicitly.'
    );
  }

  await writeFile(VERSION_PATH, `${latest}\n`, 'utf8');
  console.log(`Updated ${VERSION_PATH} to Wrangler ${latest}.`);
  console.log('Run verify.bat --no-pause before the next deployment.');
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
});
