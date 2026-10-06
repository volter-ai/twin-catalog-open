import { existsSync } from 'node:fs';
import { read, requireThat, stable, validateSources, write } from './model.mjs';

/** Prepare a separate registration PR's data. No GitHub or registry action. */
export function register(sources, source, file) {
  validateSources(sources);
  validateSources([source]);
  const existing = sources.find((s) => s.name === source.name);
  requireThat(!existing || stable(existing) === stable(source), 'source name already has a different registration');
  const next = existing ? sources : validateSources([...sources, source]);
  if (existsSync(file)) {
    const held = stable(read(file));
    requireThat(held === stable(sources) || held === stable(next), 'registration output already has different content');
  }
  write(file, next);
  return { file, source, alreadyRegistered: Boolean(existing),
    next: 'Open a separate pull request changing only sources.json. No publication or PR was performed.' };
}
