# Twin your product

This guide takes a twin from choosing the vendor to its admission in this catalog. It is written for an AI agent
working from public repositories and npm packages alone (a person can follow it the same way): every step names
the file it writes, the command it runs and what that command must print. A company twins its own product with it;
anyone twins a vendor they depend on with it. Read the [process](process.md) for identity, assessment and moderator
authority.

You end with: a public repository holding your pack, a scoped npm package published from it with provenance, a
source registration and a submission merged here, and, when you needed one, a kernel proposal. The procedure and
its reasons are the platform's [architecture, "Creating a pack"](https://world-docs.volter.ai/docs/contributing/architecture#creating-a-pack);
this guide is that procedure for your own repository, every tool a released command. Where a step names a format,
the architecture section it links holds the format.

## What you need

- Bun at the catalog policy's version (`policy.json`, `bun`) and Node 22.3 or newer.
- In your repository's `package.json`, the public `@volter/world`, `@volter/world-core`, `@volter/world-runtime` and
  `@volter/twin-standard` at the versions `policy.json` names under `tools` (the versions the catalog's admission
  runs), TypeScript and its Node and Bun types as development dependencies. Commit the lockfile.
- A public GitHub repository for the pack (npm provenance needs a public source) and an npm scope you publish to.
- One directory per vendor in that repository, named for the vendor (`<repository>/<vendor>/`); its npm package
  name is independent. Run every command below from the repository's root, naming the vendor's directory.

## 1. Choose the vendor and what to serve

Build a twin for a vendor an application calls. For your own product, the vendor is your product and the
applications are the ones that call it: your published SDKs and quickstarts, and the customer applications whose
code you can read. Read each application at a fixed commit and list every call its code makes to the vendor,
starting with what it does on boot and on sign-in, each with its file and line. That list is the pack's demand,
`journeys/demand.json`:

```json
{
  "measured": "<how and when the calls were read>",
  "applications": [
    { "name": "<owner/repository>", "commit": "<sha>", "client": "<the SDK and version it calls through>",
      "backend": [ { "call": "<the call as the code makes it>", "operation": "<the spec's operationId>", "evidence": "<path>:<line>" } ] }
  ],
  "optional": [ { "application": "<owner/repository>", "what": "<the call>", "setting": "<what turns it on>", "evidence": "<path>:<line>" } ]
}
```

A call a dependency makes is cited `<package>@<version>:<path>:<line>`, the version the application pins. The pack
serves what is demanded; every other operation of the vendor's spec is the gap, answered as the vendor answers a
request it does not know, never a made-up success. An operation the application reaches only when its operator sets
an option (an environment variable, an admin-only setting) is opted-in demand, recorded under `optional`; one it
reaches when an end user acts in the shipped product is demand. Look the vendor up in this catalog first: it may
already list implementations, and yours is another one, built from the vendor's spec, never from an earlier
implementation.

## 2. Create the pack

```sh
bunx --bun @volter/twin-standard create <vendor> --init <vendor> --package @example/<name>
```

It writes the fixed files with explicit fill markers (`--lanes a,b` for a vendor of several APIs or hosts:
[Lanes](https://world-docs.volter.ai/docs/contributing/architecture#lanes)). Declare your own public GitHub repository
and license in the package's `package.json`.

## 3. Vendor the spec

Put the vendor's published spec (OpenAPI, Smithy, protobuf, Discovery, GraphQL SDL) in `spec/`, with `spec/SOURCE.md`
naming the file on a `**File:**` line, its upstream URL and commit, its version, the sha256 of the vendor's bytes,
and who read it. Each correction is a patch in `spec/patches.json` with its reason and source. A vendor with no
published spec gets one written from its reference pages: read them with `twin-standard read-page <url> --raw`, keep
the page's bytes beside the script that writes the spec, and cite the page for every fact it supplies
([Evidence that holds](https://world-docs.volter.ai/docs/contributing/architecture#evidence-that-holds)). Read a page's
text, as the citation check reads it, with `twin-standard read-page <url>`. Never call the vendor's live API to learn
its behaviour.

## 4. The outline and the customer entry

`journeys/customer-life.outline.md` is the story in acts, reaching every demanded operation and refusal. Start from the
vendor quickstart and the pinned SDK's ordinary default requests, the app's environment and its issued identity. Name
each act's prerequisites and the earlier call, issued credential or documented input that supplies them.

At this stage write the executable customer entry, `journeys/first-use.json` (its format is under "Customer entry and
release qualification" below), before implementing resource semantics, and walk it through `twin-standard
walk-consumer` while building, with a new prepared app for each walk. When an ordinary SDK call fails, fix the pack or
the shared mechanism; keep the SDK request unchanged.

## 5. Manifest, states and the decision table

- `src/manifest.ts`: the vendor's error envelope, `auth`, ids, time, resources, doors, events, `discovery` and the
  descriptor, all data ([What a pack declares](https://world-docs.volter.ai/docs/contributing/architecture#what-a-pack-declares),
  [The descriptor](https://world-docs.volter.ai/docs/contributing/architecture#the-descriptor)). Every stored resource
  declares its `refresh` (a list, a get, or `none` with why) so a World rooted at the real vendor reads it back.
- `src/semantics/states.ts`: every state machine and every `notState` ruling, each move cited; a refusal is its own
  transition.
- `journeys/decisions.json`: `{ "decisions": [ { "operation", "demand", "mechanism": "handler" | "core" | "door", "why" } ] }`,
  one row per served operation. For an SDK call, `why` names the call and the result and stored effect the entry
  asserts. Decide the pinned client's consumed response (its envelope, required and nullable fields, pagination, typed
  errors, returned URLs) before writing the handler.

## 6. Handlers, with every vendor fact cited

Write each family top to bottom from the table, in the order the customer's acts need it: `src/semantics/<family>.ts`,
one exported `async function <operationId>(ctx: HandlerContext)` per operation. Store state through the vendor's own
operations, ids from `ctx.mint`, bytes in `ctx.blobs`, secrets from `ctx.secret`; a stored row is shown to a client
through `ctx.get`, `ctx.rows` or `ctx.own(row)`, never raw. Seed through the vendor's API; a `/_twin/` door makes only
what no operation can, except the descriptor's `credentialDoor`, the account's sign-up.

Every vendor fact a manifest, a handler or a spec patch rests on carries its citation on the line above it, in one of
three forms: `// source: <url> "<quote>"` for a page, `// source: spec:<ref> "<quote>"` for the vendored spec (an
operation id or a JSON pointer such as `spec:/components/schemas/Customer`), or `// source: recording:<file> "<quote>"`
for a captured exchange. A quote counts when its words appear on the page as served, with markup and whitespace
ignored and punctuation kept, so quote plain words rather than formatting: a backtick or an escaped quote inside a
quote will not match. A spec quote must be in the node the reference names, not in a schema that node only points
to. Where the vendor's documentation stops and the twin chooses (an id format, a delay), say so on a
`// Where the documentation stops:` line. A refusal the vendor does not document takes its documented error for that
class.

Rate limits are vendor facts too. Declare the vendor's documented limits as the manifest's `rateBudget`, charged on
every call a World makes to the real vendor. A budget that admits more calls a minute than the standard's fallback
(30 a minute, over a window of a minute or more) declares the documented allowance, `rateBudget.allowance:
{ perMinute, source }`, and cites its page on a `// source:` line with the page's words that state the number.

## 7. The life

`journeys/customer-life.json` walks the outline: the demanded applications' real calls, in their real shapes, one
customer's acts in time order, with its `author` naming the session that wrote it
([Writing a life](https://world-docs.volter.ai/docs/contributing/architecture#writing-a-life)). A step is never added to
reach a line of code or to justify serving an operation nothing demands. The vendor's published examples (a request
and answer a page shows, or a rule it states) go in `spec/doc-examples.json` and are replayed
([Published examples](https://world-docs.volter.ai/docs/contributing/architecture#published-examples)).

## 8. Derive, index and compile the facts

```sh
bunx --bun @volter/twin-standard check-sources <vendor>   # records each cited page in spec/sources.json
bunx --bun @volter/twin-standard derive <vendor>          # writes src/generated/ from the spec; refuses a citation that does not hold
bunx --bun @volter/twin-standard create <vendor> --index  # the fixed handler map and fetch
bunx --bun @volter/twin-standard facts <vendor>           # generated/pack-facts.json, from the descriptor
```

Derive before indexing (an index written before the derive maps nothing). During construction, `create <vendor>
--index --building` keeps unfinished operations as gaps, so the first loadable act can be walked before later families
exist; the plain `--index` requires the complete scope. The package README says what the pack serves, for whom, its
doors, its refusals and what it leaves out.

## Your checks

While code remains to be written, walk the journeys as often as the work needs and fix what they show:

```sh
bunx --bun @volter/twin-standard walk <vendor>           # the life, twice on fresh Worlds, its coverage and the examples
bunx --bun @volter/twin-standard examples <vendor>       # the published examples replayed
bunx --bun @volter/twin-standard coverage <vendor>       # the code and state logic the walks reach, and what they miss
bunx --bun @volter/twin-standard walk-consumer <vendor> --prepared-consumer prepared-consumer.json --out walk.json
```

`walk` prints each failing check with its step and what was answered, and names the kernel it measured. `walk
--write` keeps `journeys/score.json` and `journeys/coverage.json` with the pass. A line no walk reaches is reached by
a real call, replayed as a published example, or recorded in `journeys/unreachable.json` with the `world` no World
reaches it from ([Coverage](https://world-docs.volter.ai/docs/contributing/architecture#coverage)).

With the pack written, these run once:

1. `bunx --bun @volter/twin-standard conform <vendor>`: the one conformance command, the same the catalog runs on
   admission and on re-assessment. It serves the pack on its own as a World runs it and checks the decision table, the
   published files, the citations, refresh and ingest, the registered state system, the rate allowance, the vendor's
   SDK cases, the life over HTTP, sockets and the boot probe, every served operation called plainly and with a
   scenario loaded (no hang, no undeclared 500, no field of the twin's own, the spec's shape), the records and the
   form. Every ✗ names its check and what fails; [Conformance](https://world-docs.volter.ai/docs/contributing/architecture#conformance)
   says what each asks.
2. A judge that is not among the journeys' authors: `bunx --bun @volter/twin-standard judge-brief <vendor> --authors
   <your session id>` prints its brief. Give it to an agent session of its own; it writes the verdicts beside the
   journeys, and you apply every ruling.
3. `npm pack` the package and `conform` the tarball: the bytes a release publishes conform as the checkout does.
4. The installed assessment below.

## When the standard lacks a mechanism

A pack imports only the pack contract (`@volter/world-core`, `@volter/world-ui`). When it needs something every pack
of its kind would need (a wire protocol, an authentication strategy, a way of reading the vendor's state back, a
screen behaviour), do not write it into the pack. Propose it:

1. Open a pull request to this repository adding `proposals/kernel/<mechanism>.md`: what the vendor needs, cited as
   any vendor fact; the paragraph the architecture would take in its owning section, with a `First need:` line naming
   your pack and the vendor behaviour it serves; and the change as a patch of the released package it touches
   (`proposals/kernel/<mechanism>.patch`). Look at open proposals first and build on one that already proposes it.
2. Build your pack on the patched package while you work (`bun patch @volter/world-core`, the patch committed in your
   repository), so your checks run against it.
3. The catalog's automation reads the proposal as maintenance and runs nothing of it. A maintainer carries the
   mechanism into the kernel and releases it, or answers the proposal with why not. Then pin the release, drop your
   patch and submit. An admission never rests on an unreleased kernel; the grade's kernel-contract criterion refuses a
   pack file that imports anything but the pack contract.

## Build the package

The generated facts belong in the package artifact; keep source, spec, journeys and required fixtures there too.
Publish compiled JavaScript for Node consumers while retaining the TypeScript source the pinned standard reads. Use
TypeScript's `rewriteRelativeImportExtensions`, copy generated JSON alongside emitted modules, and point the package
export and bin at their compiled entrypoints. A `files` list includes `src`, `dist`, `generated`, `spec`, `journeys`,
README and LICENSE. A build and `npm pack --dry-run` must show those paths; no platform-specific prepack script is
required.

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
using catalog policy and released tools, then posts readiness evidence: the same `conform`, the journey replay, the
installed customer workflow and the browser target. Untrusted accounts need moderator review;
directly trusted accounts need no separate review. The [process contract](process.md) defines account trust and
maintainer authority. Fixes need a new immutable release; infrastructure failures can be retried. Authorized
maintainers merge; the publisher and catalog workflows do not. Once merged, publication lists the release in the
catalog index, and the catalog's regular re-assessment runs the same checks against it.
