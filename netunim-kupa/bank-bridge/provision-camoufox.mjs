import { CamoufoxFetcher, camoufoxPath, installedVerStr } from 'camoufox-js/dist/pkgman.js';

function compatibleCachedBrowser() {
  try {
    const installPath = camoufoxPath(false);
    const version = installedVerStr();
    return { installPath: String(installPath), version };
  } catch {
    return null;
  }
}

async function main() {
  const cached = compatibleCachedBrowser();
  if (cached) {
    console.log(`Using compatible cached Camoufox ${cached.version} from ${cached.installPath}`);
    return;
  }

  console.log('Camoufox cache is missing or incompatible; downloading a supported browser build...');
  const fetcher = new CamoufoxFetcher();
  await fetcher.install();

  const installed = compatibleCachedBrowser();
  if (!installed) {
    throw new Error('Camoufox download completed but the installed browser is still missing or incompatible.');
  }
  console.log(`Camoufox ${installed.version} is ready in ${installed.installPath}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Camoufox browser provisioning failed: ${message}`);
  process.exitCode = 1;
});
