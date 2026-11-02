# Twin catalog

The catalog admits and distributes twin packages from independent publishers. It prepares evidence for moderators;
people decide what merges. The platform and pack repositories have their own release cycles. The
[process contract](docs/process.md) defines the boundaries, states and acceptance cases.

## Use a twin

Browse the [public catalog](https://world.volter.ai/twins), choose an exact release, and follow its
**Setup** tab. Its **Overview** contains that artifact's workflows and limits; **Evidence** keeps
admission and measurements separate. Local Worlds need no Volter account or cloud subscription.
[Getting started](https://world-docs.volter.ai/docs/getting-started) runs an unchanged SDK against
a local twin, and the [cookbook](https://world-docs.volter.ai/cookbook/README) supplies more workflows.

For a twin defect, use the selected release's **Report an issue** or source repository link.
For CLI, catalog, website or documentation problems, [open an issue here](https://github.com/volter-ai/twin-catalog-open/issues/new)
and name the component. Include exact versions, the command and error, and a minimal synthetic
example; leave out credentials and real records. The [recovery guide](https://world-docs.volter.ai/docs/guides/recover-a-failed-call)
helps identify the component. Reporting a problem does not require a paid Volter account.

## Twin your product

[The contributor guide](docs/contributing.md) takes a twin from choosing the vendor to its admission here, written for
an AI agent working from public repositories and the released tools alone: the demand, the spec, citations and rate
limits, the journeys, the contributor's own checks (`twin-standard walk`, `conform`), a kernel proposal when the
standard lacks a mechanism ([proposals/kernel](proposals/kernel/README.md)), and the registration, publication and
submission below.

## Submit a release

Register a source with a pull request adding one entry to `sources.json`:

```json
{ "name": "example-team", "repository": "example/twins", "scope": "@example", "official": false, "protocol": "3", "workflow": "release.yml" }
```

The CLI can prepare that addition in your catalog fork:

```sh
twin-catalog register --source example-team --source-repository example/twins --scope @example
```

It writes `sources.json` only. An installed CLI outside a fork writes `registration/sources.json`; use `--out` for
another output path. Open a separate source-registration PR before submitting releases. A matching existing source
is idempotent; conflicting registration data is refused.

After registration merges, publish a package from that public repository with npm provenance. Its package.json names
the registered repository; its generated pack facts name the vendor it simulates. A package may have any scoped npm
name. Its artifact includes the source, spec and journeys required by the released Protocol 3 standard. Build against
the published SDK and standard; no platform checkout is needed by this catalog.

In a fork of this catalog, create the submission with its released CLI or this identical repository command:

```sh
node bin/twin-catalog.mjs submit --source example-team --vendor stripe --package @example/stripe-simulator --version 1.2.3
```

Open a PR adding only the generated `submissions/<sha256>.json`. The CLI writes data only. An operator explicitly assesses the exact artifact outside CI, verifies integrity and provenance, installs dependencies without scripts and runs the released standard in an offline container and a World. An independently registered assessment authority records its complete controller envelope in a durable GitHub evidence release; current defaults' reports also have an index-package copy. No PR event starts assessment. Code fixes require a new published version and updated submission filename. Do not edit the
index, policy or source registration as part of a release submission.

An authenticated ready assessment is evidence for a separate maintainer decision. Untrusted-account submissions require moderator review
of the exact head before merge. Direct trusted-account submissions, including forks, and eligible internal publisher
submissions permit an authorized maintainer merge without a separate review. The catalog does not approve or merge itself. A rejection is a closed PR with a reason. Moderators are named
in `.github/CODEOWNERS`.

## Consume the index

An unassessed historical release may be submitted with `--reassess`; its file belongs in `reassessments/` and goes
through the same checks and moderation. A version without its original provenance must be followed by a new release.

`@volter/twin-catalog` carries `sources.json`, `vendors/`, `recommendations.json`, `revocations.json` and `catalog.json`.
Vendor and package identities are separate. Multiple implementations remain visible; recommendations select a default
package when necessary. Stable approved versions are selected within that package. World pins do not move. Historical
index entries without an assessment are identified as unassessed.

```sh
node bin/twin-catalog.mjs check
node bin/twin-catalog.mjs defaults
node bin/twin-catalog.mjs build --out /tmp/new-catalog-output
```

The build requires committed admission records and a new output directory. It generates data without importing packs.
The website and hosted runtime consume this artifact independently; publishing it does not deploy either.

Maintainers use `node bin/twin-catalog.mjs capture-content` to retain the exact artifacts' manifests and READMEs
in a maintenance change. The distributed reader exposes them as release documentation, separate from assessment
measurements. See [release information](docs/process.md#release-information-for-users).

For discovery, use the JSON-only reader against an installed index:

```sh
twin-catalog browse --root ./node_modules/@volter/twin-catalog
twin-catalog browse --root ./node_modules/@volter/twin-catalog --vendor stripe
```

The `./browse` library export provides the same projection for a website build or another consumer:

```js
import { browse } from '@volter/twin-catalog/browse';
const catalog = browse('./node_modules/@volter/twin-catalog');
```

The reader shows each vendor's current default release. An ambiguous vendor has `selection.state: "choice-required"`
and no offered release. Filtering a package does not change the vendor's default. Selectability and assessment availability are
separate fields. Bound report measurements retain their original scope; absent measurements are `null`. The reader
checks snapshot and report digests without importing packs or reading Git history. `snapshot.integrity` is `null`
unless the caller supplies retained installation evidence; the reader does not verify the package tarball. See
[the read contract](docs/process.md#read-the-published-catalog).

## Operate admission

The [operator procedure](docs/operations.md) covers failed phases, immutable retries, revocation and credential roles.

`policy.json` pins released evaluator versions and the registry. Policy changes are separate moderator-reviewed PRs.
The evaluator requires Docker on Linux with an x86-64 runner (the pinned Bun binary is linux-x64). Reports record the actual image identity and dependency lock, PR head/base,
and policy identity. Docker network isolation applies to evaluation; preparation downloads npm packages and
attestations. No credentials enter either container.

Use the explicit operator commands, with existing GitHub authority in `GH_TOKEN` or `GITHUB_TOKEN`:

```sh
node bin/twin-catalog.mjs assess-pr --pr <number> --out <new-directory>/report.json
node bin/twin-catalog.mjs record-assessment --report <new-directory>/report.json --send
```

The controller checkout must be clean and exactly match the current PR base. `policy.assessmentAuthorities` binds
recorders by numeric account ID, exact login and type, independently from contributor trust and moderator merge
permission. Admission rereads authenticated release/asset identities, complete input bindings and report digest.
A contributor's raw JSON never certifies readiness. Historical Actions reports retain their original envelope,
digest and run identity; they are not rewritten as operator records. A changed head/base needs fresh evidence.

`policy.reviewBypassUsers`, `trustedAccounts`, `internalRepositories` and `internalBotAuthors` retain their separate
moderator exception rules. An untrusted-account admission still needs current-head non-author human approval.
Source registration alone grants neither assessment nor admission authority. `configure --apply` explicitly removes
required status/review gates and retains force-push/deletion protection; no build modifies repository settings.
There are no CI tests or merge gates.

After independent review and merge, prepare the exact index archive outside CI:

```sh
node bin/twin-catalog.mjs prepare-publication --out <new-prepared-directory>
```

Run the approved pinned-rule and custody-value keys sweep over that archive and obtain the manager's permission
naming its digest and reviewed source. Explicitly advance the separate `publish` branch to that exact source;
main integration never advances it. A registered `policy.publicationAuthorities` account stages the byte-bound
archive and receipt at `prepared-catalog-<version>`. The manual registered `publish.yml` runs only from `publish`
at the prepared SHA and uploads only those bytes with npm provenance within its one-minute job ceiling.
It installs nothing, runs no qualification and performs no registry propagation wait. Main never publishes.
`confirm-publication` performs the measured bounded registry reads outside CI. A timeout or uncertain result needs
confirmation without another upload. A durable intent written before npm prevents retries across workflow runs;
per-attempt outcome receipts retain accepted or uncertain results. The complete commands, sweep receipt format,
branch bindings and recovery paths are in [operations](docs/operations.md).

Website delivery is independent: it selects a released snapshot and exposes its own source/catalog/deployment receipt.
Nothing here deploys it or changes an existing World's pins. Source repositories must be public for npm provenance;
publication custody and trusted-workflow registration remain explicit operator responsibilities.

A publisher that has just completed npm upload can use `submit --confirm-published` to wait for its exact
version metadata before opening a PR. Only HTTP 404 is retried, every 15 seconds for at most ten minutes, based
on [the registry measurement](docs/measurements/registry-confirmation.json). Other errors and identity mismatches
fail immediately. This option performs registry reads only; it never uploads or evaluates a package.
