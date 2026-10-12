import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeStoredCredentials } from './connection-settings.mjs';
// DPAPI is an injected platform port. Importing the vault never touches files
// or starts a process. Deployed file names and encrypted JSON remain unchanged.
export function createConnectionVault({ directory, protectText, unprotectText }) {
    const CREDENTIALS_FILE = path.join(directory, 'hapoalim-credentials.dpapi');
    const CREDIT_PROFILES_FILE = path.join(directory, 'credit-card-profiles.dpapi');
    const ensureAppDir = () => fs.mkdir(directory, { recursive: true, mode: 0o700 });
    async function writeCredentials(credentials) {
        await ensureAppDir();
        const encrypted = await protectText(JSON.stringify(credentials));
        await fs.writeFile(CREDENTIALS_FILE, encrypted + '\n', { encoding: 'utf8', mode: 0o600 });
    }

    async function readCredentials() {
        try {
            const encrypted = (await fs.readFile(CREDENTIALS_FILE, 'utf8')).trim();
            if (!encrypted) return null;
            return normalizeStoredCredentials(JSON.parse(await unprotectText(encrypted)));
        } catch (error) {
            if (error?.code === 'ENOENT') return null;
            throw error;
        }
    }

    async function deleteCredentials() {
        await fs.rm(CREDENTIALS_FILE, { force: true });
    }
    async function readCreditProfiles() {
        try {
            const encrypted = (await fs.readFile(CREDIT_PROFILES_FILE, 'utf8')).trim();
            if (!encrypted)
                return [];
            const parsed = JSON.parse(await unprotectText(encrypted));
            return Array.isArray(parsed) ? parsed.filter(x => x && typeof x === 'object') : [];
        }
        catch (e) {
            if (e?.code === 'ENOENT')
                return [];
            throw e;
        }
    }
    async function writeCreditProfiles(profiles) {
        await ensureAppDir();
        const encrypted = await protectText(JSON.stringify(Array.isArray(profiles) ? profiles : []));
        await fs.writeFile(CREDIT_PROFILES_FILE, encrypted + '\n', { encoding: 'utf8', mode: 0o600 });
    }

    async function readRawFile(pathname) {
        try {
            return await fs.readFile(pathname);
        } catch (error) {
            if (error?.code === 'ENOENT') return null;
            throw error;
        }
    }

    async function restoreRawFile(pathname, content) {
        if (content === null) {
            await fs.rm(pathname, { force: true });
            return;
        }
        await ensureAppDir();
        await fs.writeFile(pathname, content, { mode: 0o600 });
    }

    async function replaceConnections(normalized) {
        const bankEncrypted = await protectText(JSON.stringify(normalized.credentials)), creditEncrypted = await protectText(JSON.stringify(normalized.profiles));
        const [oldBank, oldCredit] = await Promise.all([readRawFile(CREDENTIALS_FILE), readRawFile(CREDIT_PROFILES_FILE)]);
        try {
            await ensureAppDir();
            await fs.writeFile(CREDENTIALS_FILE, bankEncrypted + '\n', { encoding: 'utf8', mode: 0o600 });
            await fs.writeFile(CREDIT_PROFILES_FILE, creditEncrypted + '\n', { encoding: 'utf8', mode: 0o600 });
        }
        catch (error) {
            await Promise.allSettled([restoreRawFile(CREDENTIALS_FILE, oldBank), restoreRawFile(CREDIT_PROFILES_FILE, oldCredit)]);
            throw error;
        }
    }
    return Object.freeze({ readCredentials, writeCredentials, deleteCredentials, readCreditProfiles, writeCreditProfiles, replaceConnections, deleteCreditProfiles: () => fs.rm(CREDIT_PROFILES_FILE, { force: true }) });
}
