# Operate a catalog

The [process contract](process.md) owns identity and authority; [contributor instructions](contributing.md) own pack
construction. Use existing GitHub sign-ins and custody. Qualification, assessment, index preparation and registry
confirmation are explicit operator commands outside CI. Main never publishes. A publication requires independent
review, a clean keys sweep over the exact archive and the manager's permission. Publication runs from the separate
`publish` branch at the exact reviewed source; main integration never advances or dispatches it. The short provenance workflow only
uploads the prepared bytes. No automatic CI tests or merge gates run.

## Roles and credentials

`policy.assessmentAuthorities` registers assessment recorders by numeric GitHub account ID, exact login and account
type. `policy.publicationAuthorities` separately registers prepared-index uploaders. These roles are explicit policy,
not consequences of contributor trust or package ownership. `policy.trustedAccounts`, `internalRepositories` and
`reviewBypassUsers` continue to govern moderation paths. Admission checks an authorized merger's current repository
permission separately from the assessment issuer. Candidate containers receive none of these credentials.

For outside contributors, a non-author human moderator approves the current head. Trusted-account and eligible
internal PRs may use the named maintainer exception. No account may certify an artifact by supplying an unauthenticated
JSON file. `record-assessment` authenticates its GitHub issuer; admission rereads both the release author and asset
uploader and checks their registered identity. No new ChatGPT or Claude sign-in is part of this process.

## Assess and record a submission

A registered publisher's release runs `assess-pr` itself on the submission it has just opened, and fails on a report
other than `ready` (process, "Submission"); the operator steps below are then the recording authority's and the
maintainer's, for that report. An open submission without a release behind it is assessed the same way.

With Docker capable of `linux/amd64` containers, select a clean checkout at the PR's exact current base. Its policy pins the released
tools; the host controller reads submission data from the exact head through GitHub and never imports the candidate.
Image builds and all containers explicitly select that platform to match the Linux x64 Bun and native pnpm bytes;
an ARM64 host needs Docker's supported emulation. SDK fixtures install their declared manager frozen and without
scripts. A pnpm customer app retains `pnpm-lock.yaml`, including all native YAML documents; older npm apps retain
`package-lock.json`. The controller binds original bytes, parsed documents, exact format/filename and package
identities. A native manager mismatch or non-registry dependency fails preparation instead of falling back to npm.

```sh
node bin/twin-catalog.mjs assess-pr --repository <owner/catalog> --pr <number> --out <new-evidence-directory>/report.json
node bin/twin-catalog.mjs record-assessment --repository <owner/catalog> --report <new-evidence-directory>/report.json --send
```

`GH_TOKEN` or `GITHUB_TOKEN` supplies existing authorized GitHub access; never print it. Assessment is credential-free
inside its preparation and offline containers. The controller retains the container identity, full report, evaluator
and app-local dependency locks, source/PR/policy bindings and cleanup diagnostics. The recorder executes no candidate.
It publishes only a complete ready envelope for the still-current head/base to a digest-named durable evidence release.
A second identical record reuses the same bytes; another issuer or conflicting asset is refused.

A changed head/base needs a fresh assessment. A failed phase retains its exact error and logs. Fix candidate defects
in a new immutable npm version. Fix a registry or controller failure at its recorded path, then reassess. Pending,
failed, cancelled and missing results remain different from ready. Never fabricate success for an old workflow.
Historical Actions evidence keeps its original envelope, digest and run/attempt, and its original verifier remains
available for admitted releases. Removing the old workflows does not alter those reports.

The authenticated receipt establishes readiness; a separately authorized maintainer performs the admission merge.
The repository has no required CI status checks or branch review gates. `configure` displays the intended settings;
`configure --apply` is an explicit administrative act that removes those gates while retaining force-push/deletion
protection. The command never runs automatically from a build or submission.

## Prepare and publish the index

After the source PRs have their independent review and merge, use current clean main. Preparation verifies every
admission PR, moderator path and exact authenticated evidence, copies only current defaults' envelopes into the index, builds
and packs outside CI. It does not execute candidates.

```sh
node bin/twin-catalog.mjs prepare-publication --repository <owner/catalog> --out <new-prepared-directory>
```

The directory retains `prepared-publication.json`, the packed archive and the compiler output. The receipt binds
package/version, source, snapshot digest, archive SHA-256 and SHA-512 SRI. Run the approved keys sweep over that exact
archive using pinned gitleaks rules and custody-value redaction (`@volter/teams/redact`). Retain the original sweep
output. Its data receipt has `passed: true`, the exact `sha256` and `integrity`, the pinned `rules` identity and
`custodyValuesChecked: true`. Those fields report the completed sweep; writing them alone is not a keys sweep.
Obtain the manager's permission naming that archive, verdict and reviewed source before advancing `publish` or
publishing. Then explicitly advance `publish` to the receipt's exact `sourceCommit`. This is a separate authorized
operator act; no merge, preparation or staging command moves the branch. Keep the clean source checkout at that SHA.

```sh
node bin/twin-catalog.mjs stage-publication --repository <owner/catalog> --from <prepared-directory> --tag prepared-catalog-<version> --sweep <exact-sweep-receipt.json> --send
gh workflow run publish.yml --repo <owner/catalog> --ref publish -f prepared_tag=prepared-catalog-<version> -f archive_sha256=<exact-archive-sha256> -f expected_source_commit=<reviewed-source-commit>
```

Staging requires the remote `publish` head and stage tag to equal the prepared source. The deterministic tag is
shared by all attempts for that immutable version; another archive, source or issuer on it is a conflict.
It retains byte-bound inputs under a registered publication authority and writes `staged-publication.json` beside
the prepared inputs. It performs no npm upload. A commit or preparation tag is never the workflow dispatch ref.
The manual registered workflow validates the exact `publish` ref, workflow/source SHA, expected source, stage tag,
issuer, sweep, manifest and archive digest, then runs one
`npm publish <archive> --ignore-scripts --provenance` with its publication credential. It performs no install, build,
assessment or proposal. Its one-minute job ceiling bounds execution; a timeout is an unresolved upload, not proof of
success within that ceiling. Read the actual completed run duration and outcome before claiming a successful upload.

Registry confirmation runs separately outside CI:

```sh
node bin/twin-catalog.mjs confirm-publication --receipt <prepared-directory>/staged-publication.json --out <new-confirmation.json>
```

It retries HTTP 404 only, every 15 seconds for at most ten minutes, under the retained
[registry measurement](measurements/registry-confirmation.json). Other HTTP errors or conflicting identity fail
immediately. This command uses the shared registry metadata lookup, including its HTTPS and timing validation.
Retain the output with the card's evidence. Confirmation performs no upload.

Before npm, the workflow writes `publication-upload-intent.json` to the prepared release, binding the archive,
preparation receipt, source, branch, workflow and run/attempt. It retains `publication-result-<run>-<attempt>.json`
afterward with an accepted or uncertain outcome. Its `npm` field retains the actual executable, arguments, working
directory, stdout, stderr and any launch error. Credential environment values (including URI/base64 forms), URL
credentials and token/authorization text are redacted before either persistence or the workflow log. The command
emits `twin-catalog npm result: ` followed by the same JSON result on stderr, so stdout redirection does not hide it.
Read the retained npm text for its actual publish, error, dry-run or skip message; exit zero alone does not supply
that text or registry confirmation. No environment/configuration dump is recorded.
A killed runner may leave only the intent. Missing or failed
outcome persistence does not authorize another upload. Even a fresh workflow run refuses an absent version when
that version has an earlier intent. Confirm accepted or uncertain uploads through exact-version reads; never
delete the intent, replace its assets or upload that immutable version again. Matching existing SRI is reused;
different bytes always fail. Preflight failures before an intent can be corrected and dispatched normally.

## Retain documentation and selected source inputs

`capture-content` reads immutable archives at their recorded SRI, never installs or imports them. It retains README,
manifest requirements and the release's pack facts in checksum-bound `content/` receipts. Existing metadata that
predates dependency/optional peer fields or pack facts can be enriched from those same bytes without changing an
assessment. Commit the receipts in a maintenance
change before preparing a new index. Missing documentation or historical measurement stays unavailable.

World's source checkout consumes the catalog through its selected `sources/catalog` Gitlink and
`source-inputs/catalog` receipt references. After the catalog merge, select its exact main commit and retain the
durable report URLs and checksums. `hydrateEvidence(builtIndex(source), references)` downloads and validates only
current defaults' reports for the native compiler; report envelopes are generated build inputs, never committed
source inputs. `node scripts/build-catalog-source.mjs` owns this source build. Never replace the source checkout
with an installed registry package or invent installer SRI for source-built output. A registry site's separately
selected snapshot retains its actual SRI.

## Diagnose publication and website delivery

Retain source SHA, workflow attempt, preparation receipt, archive and original sweep output. For a selected run:

```sh
gh run view <run-id> --repo <owner/catalog> --log-failed
```

An uncertain upload, failed confirmation and successful admission are separate states. Diagnose the failing registry,
workflow or source path without rerunning qualification needlessly. Historical workflow artifacts are supplementary;
durable evidence and bundled reports retain their original checksum identities.

The independent site operator uses World's existing `apps/www/scripts/refresh.py` publisher. Its publication receipt
and served snapshot establish website source, catalog version/digest/integrity and deployment identity. Catalog npm
publication neither deploys the website nor changes an existing World pin. Hosting custody stays with that operator.

## Recommend, reject, revoke and pause distribution

Reject a PR with a concrete reason. An unmerged assessment adds no release to the index. With competing implementations,
change `recommendations.json` separately; versions from different packages never compete. To withdraw an admitted
release, add its exact package/version and reason to `revocations.json`, reconciling any affected recommendation.
After authorized merge and explicit index publication, the change affects future selections and preserves artifacts,
old reports and current World pins. It cannot uninstall a running pack.

`CATALOG_PUBLISH_ENABLED=false` disables future manual uploads; it does not settle an upload already underway.
Credential replacement uses the existing scoped custody workflow. Never print a key, broaden its repository scope
or revoke another consumer's key. Record target, identity and outcome without secrets. The catalog receives no
publisher npm or website credential.
