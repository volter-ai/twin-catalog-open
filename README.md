# Twin catalog

The catalog admits and distributes twin packages from independent publishers. It prepares evidence for moderators;
people decide what merges. The platform and pack repositories have their own release cycles. The
[process contract](docs/process.md) defines the boundaries, states and acceptance cases.

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

Open a PR adding only the generated `submissions/<sha256>.json`. The CLI writes data only. Automation downloads the
exact artifact, verifies its integrity and provenance, installs dependencies without scripts, runs the standard in
an offline container and a World, and updates one feedback comment. Download the JSON report and diagnostics from
the workflow artifacts; admitted reports also have a durable evidence release and an index-package copy. Code fixes require a new published version and updated submission filename. Do not edit the
index, policy or source registration as part of a release submission.

Passing automation means ready for a maintainer decision. Untrusted-account submissions require moderator review
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

Every implementation and recorded release remains visible. An ambiguous vendor has `selection.state: "choice-required"`.
Filtering a package does not change the vendor's default. Revocation, selectability and assessment availability are
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

With a repository administration token in `GH_TOKEN`, inspect the proposed branch rule:

```sh
node bin/twin-catalog.mjs configure --repository volter-ai/twin-catalog-open
```

An authorized operator adds `--apply` to require current-head readiness, stale-review dismissal, code-owner approval,
last-push approval and administrator enforcement, and enable Actions. CODEOWNERS initially names the existing
catalog administrator, `@yueranyuan`; add other authorized people or teams there through moderator review.
Ordinary commands never modify these settings. Source and catalog repositories must be public for npm provenance;
publication needs npm trusted publishing or the workflow's scoped `NPM_TOKEN`. These are activation prerequisites,
not changes performed by implementing this process.

`policy.reviewBypassUsers` names maintainers allowed to merge direct trusted-account and internal changes without
a separate review. `policy.trustedAccounts` binds direct PR authors by GitHub numeric ID, exact login and account
type, including contributions from forks. `policy.internalRepositories` separately lists registered pack repositories
eligible for the internal publisher path. Untrusted accounts still need human review; all admissions need verified
provenance and current-head readiness. The [process contract](docs/process.md) defines these admission paths.
`policy.internalBotAuthors` binds each trusted publisher bot by GitHub user ID and exact login. It grants no
exception without the internal source, same-catalog PR and authorized maintainer merge.

The publication workflow uses a GitHub App with repository administration read, contents read, checks read and
pull requests read. Install it only on the catalog repositories, set repository variable `CATALOG_READ_APP_CLIENT_ID`
and secret `CATALOG_READ_APP_PRIVATE_KEY`, and keep its private key out of source and diagnostic output. Each job
mints a short-lived token limited to its own repository; the action revokes it after the job. Existing deployments
may supply an equivalent scoped `CATALOG_READ_TOKEN`. No administration write permission is needed by publication.
Missing policy access refuses publication. Publisher CI can run `twin-catalog propose --from <submission-directory> --send` with its
separate catalog PR token; that command opens idempotent submission PRs and never approves or merges them.

Workflow dispatch with a PR number reruns readiness after an infrastructure failure. Publication dispatch retries
the same source commit: its version derives from first-parent history, and an already published matching identity is
reused. Force pushes are forbidden. A conflicting identity fails. `publish` verifies branch protection and admission
PRs before using npm credentials. Append a `package`, `version`, and `reason` entry to `revocations.json` to remove a
release from future selection; existing World pins are preserved.

Set `CATALOG_PUBLISH_ENABLED=true` only after readiness verification and moderator setup.

Volter's pack release workflow stays inactive while its source repository is private, as required by npm provenance.
Its trusted release workflow uses `CATALOG_PR_APP_CLIENT_ID` and `CATALOG_PR_APP_PRIVATE_KEY` in the pack repository
to mint a short-lived catalog contents/pull-request write token, without administration. Install that separate App
only on the target catalogs. Existing scoped `CATALOG_PR_TOKEN` configuration remains supported. Outside publishers
use their own GitHub accounts/forks, never Volter's App key. Source visibility exposes Git history and remains an
explicit owner decision.

[Build in your own repository](docs/contributing.md) uses the released tools.

Browser pages are separate work. JSON reports distinguish quick replay from full admission conformance; unmeasured
DOM, line and state coverage remain explicit. Readiness artifacts are evidence, not a fidelity guarantee.

A publisher that has just completed npm upload can use `submit --confirm-published` to wait for its exact
version metadata before opening a PR. Only HTTP 404 is retried, every 15 seconds for at most ten minutes, based
on [the registry measurement](docs/measurements/registry-confirmation.json). Other errors and identity mismatches
fail immediately. This option performs registry reads only; it never uploads or evaluates a package.
