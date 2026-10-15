import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile as execFileCb, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { parseRegistryInstallLocation } from './lib.mjs';
const executeFile = promisify(execFileCb);

export function createEverythingProcessPlatform({ root }) {
  return {
    commands: {
      execute: (file, args, { kind, timeout, signal }) =>
        executeFile(file, args, {
          encoding: 'utf8',
          windowsHide: true,
          timeout,
          ...(kind === 'es' ? { maxBuffer: 16 * 1024 * 1024, cwd: root } : {}),
          ...(signal ? { signal } : {})
        }),
      launch: (file, args) =>
        new Promise((resolve, reject) => {
          const child = spawn(file, args, {
            detached: true,
            windowsHide: true,
            stdio: 'ignore',
            cwd: root
          });
          child.once('error', reject);
          child.once('spawn', () => {
            child.unref();
            resolve();
          });
        })
    }
  };
}

export function createEverythingDiscoveryPlatform({
  root,
  processes,
  env = process.env,
  platform = process.platform
}) {
  const executables = location =>
    location
      ? [
          path.win32.join(location, 'Everything.exe'),
          path.win32.join(location, 'Everything64.exe')
        ]
      : [];
  const programFiles = env.PROGRAMFILES || 'C:\\Program Files',
    programFilesX86 = env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)',
    localAppData = env.LOCALAPPDATA || '';
  return {
    locations: {
      windows: platform === 'win32',
      esCandidates: [
        env.NETUNIM_EVERYTHING_ES_PATH,
        path.join(root, 'tools', 'es.exe'),
        path.join(env.LOCALAPPDATA || '', 'Microsoft', 'WindowsApps', 'es.exe'),
        path.join(
          env.PROGRAMFILES || 'C:\\Program Files',
          'Everything',
          'es.exe'
        ),
        path.join(
          env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)',
          'Everything',
          'es.exe'
        )
      ].filter(Boolean),
      direct: config =>
        [env.NETUNIM_EVERYTHING_EXE_PATH, config.everythingExecutable].filter(
          Boolean
        ),
      registryKeys: [
        'HKLM\\SOFTWARE\\voidtools\\Everything',
        'HKCU\\SOFTWARE\\voidtools\\Everything',
        'HKLM\\SOFTWARE\\voidtools\\Everything 1.5a',
        'HKCU\\SOFTWARE\\voidtools\\Everything 1.5a',
        'HKLM\\SOFTWARE\\WOW6432Node\\voidtools\\Everything',
        'HKLM\\SOFTWARE\\WOW6432Node\\voidtools\\Everything 1.5a'
      ],
      known: [
        ...executables(path.join(programFiles, 'Everything')),
        ...executables(path.join(programFiles, 'Everything 1.5a')),
        ...executables(path.join(programFilesX86, 'Everything')),
        ...executables(path.join(programFilesX86, 'Everything 1.5a')),
        ...executables(path.join(localAppData, 'Everything')),
        ...executables(path.join(localAppData, 'Programs', 'Everything'))
      ]
    },
    paths: { executables },
    files: {
      exists: async candidate => {
        if (!candidate) return false;
        try {
          return (await fs.stat(candidate)).isFile();
        } catch {
          return false;
        }
      }
    },
    commands: {
      where: async name =>
        (await processes.command('where.exe', [name], 3000)).stdout,
      registry: async key => {
        if (platform !== 'win32') return '';
        try {
          return parseRegistryInstallLocation(
            (
              await processes.command(
                'reg.exe',
                ['query', key, '/v', 'InstallLocation'],
                3000
              )
            ).stdout,
            'InstallLocation'
          );
        } catch {
          return '';
        }
      }
    }
  };
}
