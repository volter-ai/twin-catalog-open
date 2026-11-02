// Evidence owns the whole native lock, independently of the selected standard's private app lookup.
import { createRequire } from 'node:module';
import { requireThat, versionPattern } from './model.mjs';
import { registryURL } from './registry.mjs';
const require = createRequire(import.meta.url);

export function dependencyLockFile(format = 'npm') {
  requireThat(['npm', 'pnpm'].includes(format), 'unsupported evidence dependency lock format');
  return format === 'pnpm' ? 'pnpm-lock.yaml' : 'package-lock.json';
}

export function parseDependencyLock(text, format = 'npm') {
  dependencyLockFile(format);
  requireThat(typeof text === 'string', 'dependency lock needs its original text');
  if (format === 'npm') {
    const lock = JSON.parse(text);
    requireThat(lock?.packages && typeof lock.packages === 'object' && !Array.isArray(lock.packages), 'npm lock has no packages');
    return lock;
  }
  // JSON-only readers and historical npm evidence do not load the native-format parser.
  const documents = require('yaml').parseAllDocuments(text);
  requireThat(documents.length > 0, 'pnpm lock is empty');
  for (const document of documents) requireThat(document.errors.length === 0, `invalid pnpm lock: ${document.errors[0]?.message}`);
  const parsed = documents.map(document => document.toJS());
  requireThat(parsed.every(document => document && document.lockfileVersion === '9.0' && document.importers && document.packages),
    'pnpm evidence needs native version-9 lock documents');
  requireThat(parsed.filter(document => document.importers['.'] && !document.importers['.'].packageManagerDependencies).length === 1,
    'pnpm evidence needs one application importer');
  return parsed;
}

function pnpmPackage(locator, record) {
  const separator = locator.lastIndexOf('@'), name = locator.slice(0, separator), version = locator.slice(separator + 1);
  requireThat(/^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i.test(name) && versionPattern.test(version),
    `pnpm package is not an exact registry identity: ${locator}`);
  return { name, version, ...record };
}

export function validateRegistryLock(lock, format, registry) {
  dependencyLockFile(format);
  if (format === 'npm') {
    for (const [path, entry] of Object.entries(lock.packages)) {
      if (!path) continue;
      requireThat(!entry.link && entry.resolved && entry.integrity, `${path}: dependency is not a locked registry artifact`);
      registryURL(entry.resolved, registry);
    }
    return;
  }
  for (const document of lock) for (const [locator, record] of Object.entries(document.packages)) {
    const entry = pnpmPackage(locator, record), resolution = entry.resolution;
    requireThat(resolution && typeof resolution.integrity === 'string' && resolution.integrity &&
      !resolution.type && !resolution.directory && !resolution.repo && !resolution.commit,
      `${locator}: dependency is not a locked registry artifact`);
    if (resolution.tarball) registryURL(resolution.tarball, registry);
  }
}

export function directDependency(lock, format, name) {
  dependencyLockFile(format);
  if (format === 'npm') return lock.packages[`node_modules/${name}`];
  const application = lock.find(document => document.importers['.'] && !document.importers['.'].packageManagerDependencies);
  const importer = application.importers['.'];
  const selections = ['dependencies', 'devDependencies', 'optionalDependencies'].flatMap(group => importer[group]?.[name] ? [importer[group][name]] : []);
  requireThat(selections.length <= 1, `${name}: ambiguous direct dependency in retained pnpm lock`);
  if (!selections.length) return undefined;
  const selected = String(selections[0].version), version = selected.split('(')[0];
  requireThat(versionPattern.test(version), `${name}: direct dependency is not a registry version`);
  const record = application.packages[`${name}@${version}`];
  requireThat(record, `${name}: direct dependency has no retained package resolution`);
  return { version, integrity: record.resolution?.integrity };
}
