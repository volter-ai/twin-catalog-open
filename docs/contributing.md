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

- Node 22.9 or newer for the catalog CLI, and the Bun/pnpm versions required by the SDK you develop against.
- In your repository's `package.json`, compatible `@volter/world`, `@volter/world-core`, `@volter/world-runtime`,
  `@volter/twin-standard`, TypeScript and Node/Bun types as development dependencies. Commit the dependency lock.
  Development may link sibling source and needs no release. Admission reads artifact data without installing an
  evaluator cohort or candidate dependencies.
  Run the standard as `./node_modules/.bin/twin-standard`, the version that lockfile installs: without the
  installation it fails there, where `bunx` or `bun run` would run another version found elsewhere.
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

To twin a vendor other applications call, choose it from [`demand.json`](../demand.json): each vendor the public
applications it names call, read at the commits it records, ranked by the applications that call it, with each
application's evidence (an SDK in its manifest, an environment name in the file that reads it, a request host with
the file and line that sends it) and `listed`, whether this catalog lists an implementation. A vendor with
`listed: false` has none yet. Its evidence is where your reading of each application's calls starts, at the same
commit.

## 2. Create the pack

```sh
./node_modules/.bin/twin-standard create <vendor> --init <vendor> --package @example/<name>
```

It writes the fixed files with explicit fill markers (`--lanes a,b` for a vendor of several APIs or hosts:
[Lanes](https://world-docs.volter.ai/docs/contributing/architecture#lanes)). Declare your own public GitHub repository
and license in the package's `package.json`.

## 3. Vendor the spec

Put the vendor's published spec (OpenAPI, Smithy, protobuf, Discovery, GraphQL SDL) in `spec/`, with `spec/SOURCE.md`
naming the file on a `**File:**` line, its upstream URL and commit, its version, the sha256 of the vendor's bytes,
and who read it. Each correction is a patch in `spec/patches.json` with its reason and source. A vendor with no
published spec gets one written from its reference pages: read them with `twin-standard read-page <url> --raw`, keep
the page's bytes in `spec/originals/`, and cite the page for every fact it supplies
([Evidence that holds](https://world-docs.volter.ai/docs/contributing/architecture#evidence-that-holds)). Read a page's
text, as the citation check reads it, with `twin-standard read-page <url>`. Never call the vendor's live API to learn
its behaviour.

## 4. The outline and the customer entry

`journeys/customer-life.outline.md` is the story in acts, reaching every demanded operation and refusal. Start from the
vendor quickstart and the pinned SDK's ordinary default requests, the app's environment and its issued identity. Name
each act's prerequisites and the earlier call, issued credential or documented input that supplies them.

At this stage document the customer entry in `journeys/first-use.json`, before implementing resource semantics.
Preserve its pinned client's ordinary request shape. Construct the whole life before its one final walk; no client
qualification or replay runs during construction.

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
what no operation can. Credentials follow the vendor's documented issuance and lifecycle.

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
customer's acts in time order, with its `author` naming the author or author role
([Writing a life](https://world-docs.volter.ai/docs/contributing/architecture#writing-a-life)). A step is never added to
reach a line of code or to justify serving an operation nothing demands. Vendor examples and reference pages inform
the pinned contract and expectations; admission does not replay a second example suite.

## 8. Derive, index and compile the facts

```sh
./node_modules/.bin/twin-standard check-sources <vendor>   # records each cited page in spec/sources.json
./node_modules/.bin/twin-standard derive <vendor>          # writes src/generated/ from the spec; refuses a citation that does not hold
./node_modules/.bin/twin-standard create <vendor> --index  # the fixed handler map and fetch
./node_modules/.bin/twin-standard facts <vendor>           # generated/pack-facts.json, from the descriptor
```

Derive before indexing (an index written before the derive maps nothing). During construction, `create <vendor>
--index --building` keeps unfinished operations as gaps, so the first entry can load before later families
exist; the plain `--index` requires the complete scope. The package README says what the pack serves, for whom, its
doors, its refusals and what it leaves out.

## Finish the life and retain its review

Static source/form checks, derivation and package construction remain authoring tools. Once the pack is complete,
run its one customer life once, through the installed standard:

```sh
./node_modules/.bin/twin-standard walk <vendor>
```

Never put the walk in CI or a hook. An independent judge reads the outline, scenario and cited vendor contract.
Print its brief with author names, never execution identifiers:

```sh
./node_modules/.bin/twin-standard judge-brief <vendor> --authors <author-name>[,<author-name>...]
```

The judge retains `journeys/customer-life.outline.verdict.json` and `journeys/customer-life.verdict.json`, naming
`judge.agent`, reviewer role/name and all authors. The judge is outside the authors. Apply its rulings. This one
judging stands through corrections; later changes keep the verdict and its originally judged hash. Admission
reads the retained result and adds no client, browser, replay or baseline execution.

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
3. The catalog reads the proposal as maintenance and runs nothing of it. A maintainer carries the mechanism into
   the kernel or answers why not. Development continues against source; release follows its separate authorized
   schedule. The grade's kernel-contract criterion refuses pack files that import outside the pack contract.

## Build the package

Use `./node_modules/.bin/twin-standard pack <vendor>` as the canonical procedure specifies. Its generated facts
belong in the artifact; keep source, spec, decision table, outline, life and both independent verdicts there too.
Publish compiled JavaScript for Node consumers while retaining the TypeScript source the pinned standard reads. Use
TypeScript's `rewriteRelativeImportExtensions`, copy generated JSON alongside emitted modules, and point the package
export and bin at their compiled entrypoints. A `files` list includes `src`, `dist`, `generated`, `spec`, `journeys`,
README and LICENSE. A build and `npm pack --dry-run` must show those paths; no platform-specific prepack script is
required.

## Customer entry

Package the documented first-use entry in `journeys/first-use.json` as the platform procedure specifies. It names
the pinned client, setup and ordinary vendor calls, with supported workflow and limits in the README. The one
customer life supplies the executable scenario. Admission reads its nonempty steps and retained independent
plausibility verdicts; it never installs a second client fixture or executes candidate code.

## Register and publish

Register your public repository, npm scope and release workflow in a separate authorized `sources.json` PR; untrusted accounts need moderator review.
In your catalog fork, prepare the one-source change using the catalog CLI:

```sh
twin-catalog register --source example-team --source-repository example/twins --scope @example --workflow release.yml
```

The command prepares data only and refuses conflicting registrations. Outside a fork it writes `registration/sources.json`;
copy that file into your fork and open the separate PR. Registration does not authorize a release or grant maintainer status.

Pin dependencies and commit the lock. Complete the pack, its one final life walk and independent review, then
keys-sweep the exact archive outside CI. Publication follows its separate authorized schedule. Your manually
dispatched registered workflow accepts only that prepared archive and uses existing scoped custody. Public npm
publication requires provenance from the registered public source:

```sh
npm publish <exact-reviewed-archive.tgz> --ignore-scripts --access public --provenance
```

The artifact's repository URL matches the registered repository; the signing workflow filename matches registration.
Volter's registered public pack source also requires `refs/heads/publish`: its workflow executes from that branch
at the exact reviewed preparation commit. Main never advances or dispatches it. The catalog's original assessment
policy binds any source-specific publication ref; an independent publisher follows its registered policy.
Publishing does not admit a release. After source registration has merged, use the catalog CLI from a catalog fork:

```sh
twin-catalog submit --source example-team --vendor stripe --package @example/payments --version 1.2.3
```

Open a PR adding only its generated submission. Outside CI a catalog operator checks the immutable artifact's
identity, integrity, source binding, nonempty life and retained independent plausible verdicts as data. A separate
registered assessment authority records the checksum-bound envelope in a durable authenticated release. npm's
visibility API chooses the source rule: public packages require Sigstore provenance; restricted packages require
their registered source repository and immutable `sourceCommit` (use `--source-commit` when registry metadata has
no `gitHead`), exact version/integrity and existing authority checks. No PR event executes candidate code and
publisher-supplied JSON grants no readiness. Untrusted accounts need moderator review;
directly trusted accounts need no separate review. The [process contract](process.md) defines account trust and
maintainer authority. Fixes need a new immutable release; infrastructure failures can be retried. Authorized
maintainers merge; the publisher and catalog workflows do not. Once merged, publication lists the release in the
catalog index. Later explicit reassessments retain their own inputs and scope; missing historical measurements are not invented.
