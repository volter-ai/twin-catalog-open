import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { read, requireThat } from '../lib/model.mjs';

/** Select the trusted fixture's declared installer; every installation disables scripts. */
export function dependencyInstall(directory, policy, { frozen = false } = {}) {
  const manifest = read(join(directory, 'package.json')), declared = manifest.packageManager;
  const pnpm = /^pnpm@(\d+\.\d+\.\d+)$/.exec(declared ?? '')?.[1];
  if (pnpm) {
    requireThat(pnpm === policy.pnpm, 'declared pnpm differs from the policy-pinned native installer');
    requireThat(!frozen || existsSync(join(directory, 'pnpm-lock.yaml')), 'frozen pnpm fixture has no native lock');
    return { command: '/opt/catalog/node_modules/@pnpm/exe.linux-x64/pnpm',
      args: ['--dir', directory, 'install', ...(frozen ? ['--frozen-lockfile'] : []), '--ignore-scripts',
        '--store-dir', join(directory, '.pnpm-store'), '--registry', policy.registry],
      cwd: '/work', file: 'pnpm-lock.yaml', format: 'pnpm', packageManager: declared, manifest };
  }
  if (frozen && existsSync(join(directory, 'bun.lock'))) {
    requireThat(!declared || declared === `bun@${policy.bun}`, 'declared Bun differs from the policy-pinned installer');
    return { command: 'bun', args: ['install', '--frozen-lockfile', '--ignore-scripts', '--registry', policy.registry],
      cwd: directory, file: 'bun.lock', format: 'bun', packageManager: `bun@${policy.bun}`, manifest };
  }
  requireThat(!declared || /^npm@\d+\.\d+\.\d+$/.test(declared), 'fixture declares an unsupported or unpinned installer');
  return { command: 'npm', args: [frozen ? 'ci' : 'install', '--ignore-scripts', '--no-audit', '--no-fund', '--registry', policy.registry],
    cwd: directory, file: 'package-lock.json', format: 'npm', packageManager: declared ?? 'npm', manifest };
}
