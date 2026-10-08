# Publish from your own repository

The catalog accepts independently named packages from independently owned repositories. Use the released standard,
not scripts from a platform checkout. Read the [process](process.md) for identity, assessment and moderator authority.

## Build a pack

Install Bun at the catalog policy's version and the public `@volter/world`, `@volter/world-core`, `@volter/world-runtime` and
`@volter/twin-standard` versions in `policy.json`. Install TypeScript and its Node/Bun types as development dependencies.
Keep the package directory named for the vendor; its npm package name is independent.
Run the installed standard from the repository root. The explicit local path refuses if
installation is incomplete; it does not download a package by the `twin-standard` command name.

```sh
bun ./node_modules/.bin/twin-standard create stripe --init stripe --package @example/payments
```

The generated files contain explicit fill markers. Author the vendored spec and its provenance, demand, manifest,
stored resource states, decision table, handlers and customer journey in the standard's required order. Start the
outline from the vendor quickstart and pinned SDK's ordinary default requests, app environment and issued identity.
Write the executable customer entry as `journeys/first-use.json` at this outline stage, before implementing
resource semantics; its format is below. Walk it through `runConsumerWorkflow` while building, using a new
prepared app for each walk. Fix the pack or shared mechanism when an ordinary SDK call fails; keep the SDK
request unchanged. Source coverage reports describe source journeys and do not establish installed readiness. The package
README describes its vendor surface, refusals and limits. Declare your own public GitHub repository and license in
package.json. Complete source requirements before derivation:

```sh
bun ./node_modules/.bin/twin-standard check-sources stripe
bun ./node_modules/.bin/twin-standard derive stripe
bun ./node_modules/.bin/twin-standard create stripe --index
bun ./node_modules/.bin/twin-standard facts stripe
```

The command has the same handler-map and kernel contract as Volter's own wrapper. The generated facts belong in the
package artifact; keep source, spec, journeys and required fixtures there too. Publish compiled JavaScript for Node
consumers while retaining the TypeScript source the pinned standard reads. Use TypeScript's
`rewriteRelativeImportExtensions`, copy generated JSON alongside emitted modules, and point the package export and
bin at their compiled entrypoints. A `files` list includes `src`, `dist`, `generated`, `spec`, `journeys`, README and
LICENSE. A build and `npm pack --dry-run` must show those paths; no platform-specific prepack script is required.

## Customer entry and release qualification

Author the customer entry with the outline, then package it in `journeys/first-use.json`. It has `schemaVersion: 1`, the upstream `source`, an
`about` describing its scope, and a `files` map of relative paths to text. Include `package.json` with exact registry
SDK dependencies, `.env.example` with the names the app reads, and its unchanged client script with result
assertions. `run` is an argument array such as `["node", "workflow.mjs"]`. For stored workflows,
`retention: { "readback": ["node", "readback.mjs"] }` inspects prior state without creating it again. A stateless
workflow instead declares `retention: { "none": "<why no stored vendor resource is created>" }`. Use SDKs to create
stored data and existing vendor doors for synthetic setup; do not use scenario success in place of a stored write.
The standard owns CLI lifecycle and teardown, so the scripts do not start or stop infrastructure themselves. For a timed workflow, `clock: { "at": "<ISO instant>", "advanceAfterRun": "10s" }` freezes time before the client runs, then advances and inspects the due result before retention is measured. The duration is the journey’s chosen synthetic wait, not a vendor timing guarantee.

Walk the life's journeys and this first-use journey while implementing. For final qualification, build and pack
first, install that tarball in a fresh directory without development links, and run the released standard against
the installed package. Keep the archive inventory and lockfile. Prepare a new customer app beside that installation:

```sh
twin-standard prepare-consumer <installed pack dir> --app <new app dir> --cli <absolute installed volter executable> --integrity <packed SHA-512 integrity> --out prepared-consumer.json
npm install --prefix <new app dir> --ignore-scripts --no-audit --no-fund
```

This preparation writes fixture files only; SDK dependency installation precedes offline execution. Select `--cli` from the installed `@volter/world` package's declared `bin.volter`, rather than the shared
`node_modules/.bin/volter`: another package may claim that shortcut. The runner invokes compiled JavaScript
through Node and records the actual entrypoint, command and Node version. The product CLI must resolve the installed candidate through that app's parent dependency directory. For the final assessment,
run the released standard through a World:

Create `assessment.world.config.json`:

```json
{ "id": "pack-assessment", "services": [], "network": { "egress": [] } }
```

```sh
volter-world run assessment.world.config.json --root . --env-out /tmp/new-assessment.env --owner pack-assessment -- twin-standard assess <installed pack dir> --prepared-consumer prepared-consumer.json --browser --out assessment.json
```

The outer assessment config has no vendor services; the standard creates fresh in-memory state for journey replay
and uses the product CLI to own a separate app World for the installed customer workflow.
For an HTTP browser target, use Linux, install Playwright at the catalog policy version and its Chromium binary,
and install `libfaketime` (Debian/Ubuntu: `sudo apt-get install libfaketime`). The browser process uses the World
clock for native cookie expiry, at one-second precision; JavaScript time retains millisecond precision. Authors on
other platforms can omit `--browser` for in-process assessment; catalog Actions supplies the browser target. The report
separates declared served/gap counts, operations actually exercised, deterministic replay, conformance, installed customer workflow and Chromium
results. It does not measure DOM interactions, line coverage, real-vendor parity or every possible state transition.

Local assessment helps authors; it does not replace the independent catalog assessment of the published tarball.
Linux catalog preparation disables installation scripts. A dependency that requires a build cannot depend on its
postinstall having run there: distribute the needed portable build or choose supported dependencies.

## Register and publish

Register your public repository, npm scope and release workflow in a separate authorized `sources.json` PR; untrusted accounts need moderator review.
In your catalog fork, prepare the one-source change using the catalog CLI:

```sh
twin-catalog register --source example-team --source-repository example/twins --scope @example --workflow release.yml
```

The command prepares data only and refuses conflicting registrations. Outside a fork it writes `registration/sources.json`;
copy that file into your fork and open the separate PR. Registration does not authorize a release or grant maintainer status.

Pin your own dependencies and commit the lock. Your workflow runs on GitHub-hosted Linux with `id-token: write`,
builds your artifact, and uses npm trusted publishing or your own scoped npm credential:

```sh
npm publish --ignore-scripts --access public --provenance
```

The artifact's repository URL matches the registered repository; the signing workflow filename matches registration.
Publishing does not admit a release. After source registration has merged, use the catalog CLI from a catalog fork:

```sh
twin-catalog submit --source example-team --vendor stripe --package @example/payments --version 1.2.3
```

Open a PR adding only its generated submission. The Actions job checks the registry artifact at the exact integrity,
using catalog policy and released tools, then posts readiness evidence. Untrusted accounts need moderator review;
directly trusted accounts need no separate review. The [process contract](process.md) defines account trust and
maintainer authority. Fixes need a new immutable release; infrastructure failures can be retried. Authorized
maintainers merge; the publisher and catalog workflows do not.
