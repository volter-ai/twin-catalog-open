import { randomUUID } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { digest, write, requireThat } from './model.mjs';

/** Own a credential-free container workspace; assessment and transport verification share its boundary. */
export function withContainer(root, input, output, execute, { spawn = spawnSync } = {}) {
  const id = `twin-catalog-${randomUUID()}`;
  const runOwner = process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT ?? 1}` : id;
  const work = mkdtempSync(join(tmpdir(), 'twin-catalog-input-'));
  // mkdtemp is 0700; the container's unprivileged uid must traverse this data-only input directory.
  chmodSync(work, 0o755);
  write(join(work, 'input.json'), input);
  chmodSync(join(work, 'input.json'), 0o644);
  const imageFile = join(work, 'image-id');
  const logs = [];
  const run = (args, allowFailure = false) => {
    const r = spawn('docker', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    logs.push({ command: args[0], status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', error: r.error?.message });
    if (!allowFailure) requireThat(r.status === 0, `container ${args[0]} failed: ${r.error?.message ?? r.stderr}`);
    return r;
  };
  const volumes = [];
  const customerVolume = `${id}-customer`;
  try {
    const tools = input.policy.tools;
    requireThat(tools['@volter/world'], 'policy must pin the product CLI for installed customer workflows');
    run(['build', '--iidfile', imageFile, '--build-arg', `NODE_IMAGE=${input.policy.nodeImage}`, '--build-arg', `BUN_VERSION=${input.policy.bun}`, '--build-arg', `STANDARD_VERSION=${tools['@volter/twin-standard']}`, '--build-arg', `CORE_VERSION=${tools['@volter/world-core']}`, '--build-arg', `RUNTIME_VERSION=${tools['@volter/world-runtime']}`, '--build-arg', `CLI_VERSION=${tools['@volter/world']}`, '--build-arg', `PLAYWRIGHT_VERSION=${tools.playwright}`, '-f', join(root, 'runner/Dockerfile'), root]);
    const image = readFileSync(imageFile, 'utf8').trim();
    requireThat(/^sha256:[a-f0-9]{64}$/.test(image), 'container image has no immutable identity');
    for (const volume of [id, customerVolume]) {
      run(['volume', 'create', '--label', `twin-catalog.owner=${id}`, '--label', `twin-catalog.run=${runOwner}`, volume]);
      volumes.push(volume);
    }
    // Only these task-owned new volumes are changed; both persist across container phases.
    run(['run', '--rm', '--label', `twin-catalog.owner=${id}`, '--label', `twin-catalog.run=${runOwner}`, '--network', 'none', '--user', '0', '--entrypoint', 'chown', '-v', `${id}:/work`, '-v', `${customerVolume}:/customer`, image, '1000:1000', '/work', '/customer']);
    const common = ['run', '--rm', '--label', `twin-catalog.owner=${id}`, '--label', `twin-catalog.run=${runOwner}`, '--init', '--shm-size', '256m', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--tmpfs', '/tmp:rw,nosuid,nodev', '-e', 'HOME=/tmp/home', '-e', 'npm_config_cache=/tmp/npm-cache', '-v', `${id}:/work`, '-v', `${customerVolume}:/customer`, '-v', `${work}:/input:ro`];
    return execute({ image, common, run, owner: id });
  } finally {
    const cleanup = volumes.map(volume => ({ volume, result: run(['volume', 'rm', volume], true) }));
    write(`${output}.logs.json`, logs);
    // Retain input identity and diagnostics on failure; no other actor's resources are touched.
    const failed = cleanup.filter(({ result }) => result.status !== 0);
    requireThat(failed.length === 0, `owned volume teardown could not be verified: ${failed.map(({ volume }) => volume).join(', ')}`);
  }
}

/** The host never imports a candidate. Docker supplies the enforced offline evaluation boundary. */
export function evaluate(root, input, output, options = {}) {
  requireThat(input.policy.requireProvenance === true, 'admission requires verified provenance');
  let phase = 'container-setup';
  let imageIdentity = null;
  try {
    return withContainer(root, input, output, ({ image, common, run, owner }) => {
      imageIdentity = image;
      phase = 'artifact-preparation';
      run([...common, image, '/opt/catalog/runner/prepare.mjs']);
      const prepared = JSON.parse(run([...common, '--network', 'none', image, '-e', 'process.stdout.write(require("fs").readFileSync("/work/prepared.json","utf8"))']).stdout);
      requireThat(prepared.integrity === input.submission.integrity, 'prepared artifact identity changed');
      const lock = run([...common, '--network', 'none', image, '-e', 'process.stdout.write(require("fs").readFileSync("/work/package-lock.json","utf8"))']).stdout;
      requireThat(digest(lock) === prepared.dependencyLockSha256, 'dependency lock identity changed');
      write(`${output}.lock.json`, JSON.parse(lock));
      requireThat(prepared.consumer?.appDir === '/customer/app', 'prepared customer app is outside its owned volume');
      const consumerLock = run([...common, '--network', 'none', image, '-e', 'process.stdout.write(require("fs").readFileSync("/customer/app/package-lock.json","utf8"))']).stdout;
      requireThat(digest(consumerLock) === prepared.consumerDependencyLockSha256, 'customer SDK lock identity changed');
      write(`${output}.consumer-lock.json`, JSON.parse(consumerLock));
      phase = 'offline-assessment';
      const result = run([...common, '--network', 'none', '--entrypoint', 'bun', image, '/opt/catalog/node_modules/@volter/world-runtime/src/cli.ts', 'run', '/work/world.json', '--root', '/work', '--env-out', '/work/world.env', '--owner', owner, '--', 'bun', '/opt/catalog/runner/evaluate.mjs'], true);
      const reportRead = run([...common, '--network', 'none', image, '-e', 'process.stdout.write(require("fs").readFileSync("/work/report.json","utf8"))'], true);
      const report = reportRead.status === 0 ? JSON.parse(reportRead.stdout) : null;
      requireThat(!report || (report.schemaVersion === 1 && report.package === input.submission.package && report.version === input.submission.version && report.integrity === input.submission.integrity), 'evaluator returned a mismatched report');
      const envelope = { schemaVersion: 1, inputSha256: digest(input), input, image, prepared, dependencyLock: JSON.parse(lock), consumerDependencyLock: JSON.parse(consumerLock), status: result.status === 0 && report?.ready === true ? 'ready' : 'changes-needed', report, evaluatedAt: new Date().toISOString() };
      write(output, envelope);
      return envelope;
    }, options);
  } catch (error) {
    const envelope = { schemaVersion: 1, inputSha256: digest(input), input, image: imageIdentity, status: 'changes-needed', phase, error: String(error.message ?? error), report: null, evaluatedAt: new Date().toISOString() };
    write(output, envelope);
    return envelope;
  }
}
