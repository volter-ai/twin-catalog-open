# Catalog process

This catalog distributes vendor implementations and immutable package releases from registered publishers. The platform owns the runtime and Protocol 3; publishers
own pack construction and their artifacts. Admission reads the retained publisher review without replaying it.
[ADR 0001](adr/0001-retained-publisher-review.md) owns that boundary.

## Identity and authority

A vendor is a service being simulated. An implementation is an npm package. A release is an exact package/version
and SHA-512 integrity. A source is a registered GitHub repository, npm scope and provenance workflow. Many packages
can implement a vendor. Versions are ordered only within one package. Existing World pins never move with the catalog.

`sources.json` registers sources in a separate authorized PR. A submission cannot grant trust or change policy.
`official` identifies Volter's source, whose releases are used as published through its own release door; it is no
vendor endorsement. Other sources follow admission below. Existing records remain valid under their original
admission. Absent historical evidence is never manufactured.

Untrusted PR authors need current-head non-author human moderator approval. `policy.trustedAccounts` identifies
trusted authors by numeric GitHub account ID, exact login and type (`User` or `Bot`), including forks. Commit
authors, fork owners and organization membership grant no such trust. A named `reviewBypassUsers` maintainer with
current `admin` or `maintain` permission can merge a trusted-account submission without a separate review. The
receipt records `trusted-account-merge` and the account identity.

The internal path separately requires an `internalRepositories` source, same-catalog-repository PR and authorized
maintainer merge with current permission. Its author must be a repository member/collaborator, its Actions bot,
or an `internalBotAuthors` publisher bot. A configured bot binds GitHub user ID and exact login; an App ID is a
different identity. A bot or official badge alone grants no exception. Contributor trust, source registration,
assessment authority and merge permission are separate roles.

`recommendations.json` selects a package when live implementations compete. One package is unambiguous; several
without a recommendation require an explicit choice. The selected package's newest stable admitted version is
offered. Prereleases require an explicit version. Revocation affects future selection, never an existing dependency.

## Submission

A release PR adds exactly one `submissions/<id>.json`, with no executable files or index edits:

```json
{
  "schemaVersion": 1,
  "source": "example-team",
  "vendor": "stripe",
  "package": "@example/stripe-simulator",
  "version": "1.2.3",
  "integrity": "sha512-BASE64_OF_THE_ARTIFACT_DIGEST"
}
```

The id is SHA-256 over canonical submission fields. `submit` reads exact registry metadata and writes data; it
neither publishes nor opens a PR. Ranges, tags, URLs and git dependencies are not release identities. An admitted
package/version cannot acquire different bytes, vendor or source. `reassessments/<id>.json` can add evidence for
an unassessed historical release without rewriting its admission. A working pin needs no reassessment because
the controller changes. A restricted package additionally supplies `sourceCommit`, an immutable Git commit in its
registered source repository; old submissions without that field keep their original identity.

## Artifact and retained review

`assess-pr` runs outside CI from a clean checkout at the current PR base. It reads the exact head through GitHub
under that base's policy and source registrations, then fetches the immutable artifact. Existing npm configuration
supplies restricted-registry credentials. Credentials go only to a matching configured host/path; redirects are
refused and raw credential-bearing errors are not retained.

The registry's npm visibility API chooses the admission rule; neither a submission flag nor a manifest can choose
it. The controller always recomputes SHA-512. For public packages it cryptographically verifies the exact Sigstore
bundle. Its signer, subject and repository/workflow must match the registered source and artifact. `provenanceRefs` additionally binds
the exact branch, workflow ref and resolved source commit. A certificate-shaped string or publication receipt is
insufficient. A restricted package instead binds registered repository, the submitted `sourceCommit`, exact version
and integrity under the existing authority checks. The commit must exist in that repository; registry `gitHead`,
when present, must agree. Restricted access does not require npm provenance, which npm does not issue for it.

Archive parsing accepts safe ordinary files/directories under `package/`, without duplicate paths, symlinks,
traversal, dependencies or installation configuration. The manifest must match package/version, registered
repository and redistributable license. Dependency declarations use registry semver ranges. Generated facts name
exactly the submitted vendor and Protocol 3. These are data checks. Canonical source/form checks remain publisher
authoring tools: derivation can load authored manifest/state code. Admission never imports candidate code,
derives, installs dependencies, creates a World, runs a client/browser, or measures a previous release.

The artifact carries these four files:

- `journeys/customer-life.outline.md`, a nonempty outline;
- `journeys/customer-life.json`, with nonempty `steps`;
- `journeys/customer-life.outline.verdict.json`;
- `journeys/customer-life.verdict.json`.

Both verdicts say `plausible: true`, name `judge.agent` and nonempty `authors`, and attribute a judge outside the
authors. The life's author cannot be its named judge. The standard's one judging stands through later corrections:
the original judged hash is retained, not required to equal the corrected file hash. The publisher's final life run
and independent review remain publisher evidence. Admission adds no execution or fidelity score.

## State and invalidation

New envelopes have `schemaVersion: 2` and `kind: "publisher-review"`. Their input digest binds repository, PR,
head/base, controller source, submission, source registration and trusted-base policy. `prepared` retains artifact
integrity, registry visibility, source commit, required public provenance, package metadata, README and generated
facts. `report.publisherReview` retains each of the four files with its archive path, exact UTF-8 text and SHA-256.
New records contain no image, dependency
installation, client, browser, replay or baseline measurement.

A changed head, base or PR state invalidates the in-progress result. Failed, interrupted, superseded and missing
results cannot establish readiness. Changed artifact bytes need a new immutable release; registry/controller
failures are corrected at their owner before retrying. No PR event starts candidate qualification.

`record-assessment --report <file> --send` separately authenticates a data write. It accepts only a complete ready
envelope for the current PR. The issuer must match `assessmentAuthorities` by numeric ID, exact login and type.
It publishes `report.json` in a durable release named for submission and report digest. Release author and asset
uploader must be the same registered authority. Admission rereads the asset, checksum, original policy/source,
immutable PR file and exact base/head; recording checks the current registry visibility again. Contributor JSON
grants no readiness. A different ready receipt for the same head conflicts; changing the head needs a fresh record.

Readiness is evidence for a separate maintainer decision. Every moderator exception retains current-account and
permission checks. Merging adds one immutable admission; rejection is the closed PR and concrete reason.
`configure --apply` explicitly removes status/review gates while retaining force-push/deletion protection. No build
modifies repository settings. There are no automatic CI tests or merge gates.

SchemaVersion 1 operator envelopes keep original image, tools, provenance and original lock-byte checks. Historical
Actions evidence keeps its workflow, run/attempt and checksum. No old record is converted, replayed or relabeled.
Policy changes govern subsequent admission and never change the meaning of older evidence.

## Release information for users

The reader projects each vendor's current default after validating the full ledger and snapshot. Ambiguity keeps
`choice-required` and offers no release; filtering a package never changes the default. Selectability, recorded
admission and available evidence are separate fields.

Artifact metadata exposes description, license, engines, peers, source directory and issue tracker. Source links
use the provenance-bound commit. `capture-content` can retain the same immutable artifact's manifest, README and
generated facts in checksum-bound `content/` data. It installs/imports nothing and supplies no missing historical
review or measurement. Documentation identifies simulated behavior and gaps.

`publisherReview` exposes new retained records separately; `measurements` is null for them. Historical measurements
keep original surface, exercised operations, SDK/customer conditions, replay and browser scope. Absent fields stay
null. Provenance establishes source/build identity, never vendor fidelity. A badge supplies no measurement.

## Read the published catalog

The npm artifact is the distribution interface. `catalog.json` schema 1 records vendor/package/version, source,
status, integrity when known and evidence reference. Current defaults' bound reports/content ship in the index;
durable URLs/digests remain in the ledger for other records. Native `build` hydrates reports from retained catalog
receipt metadata without running them. New snapshots bind policy metadata; historical snapshots retain their
original digest contract.

`browse` and `./browse` read installed JSON without Git, network, candidate imports or login, checking snapshot,
report and release bindings. Installer tarball integrity belongs to the caller; `snapshot.integrity` stays null
unless supplied. A site independently chooses a snapshot. Catalog publication deploys no site and changes no pin.

## Merge and publication

Main is integration and the admission ledger; it never publishes. `prepare-publication --out <new-folder>` verifies
admissions/evidence and packs one exact index archive outside CI. A keys sweep checks those bytes with pinned
rules and custody-value redaction. Manager permission names archive digest and reviewed source before any private
publication. Public releases additionally follow the owner's launch schedule.

`stage-publication` retains archive and receipt under a registered `publicationAuthorities` issuer. The separate
publication door checks source, manifest, sweep, archive SHA-256/SHA-512 and immutable version. An intent precedes
npm, and accepted/uncertain outcomes retain redacted command output. Uncertain uploads are confirmed read-only,
never repeated. Conflicting published bytes are refused. `confirm-publication` retries only propagation-related
HTTP 404 under the existing measured bound and never uploads. [Operations](operations.md) covers custody/recovery;
[contributing](contributing.md) follows the standard's authoring procedure.
