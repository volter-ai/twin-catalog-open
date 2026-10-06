# Operate a catalog

Select the catalog and publisher repositories for the operation. Use the authorized production or test targets; these commands do not select public source scope or alter an existing World. The [process contract](process.md) owns admission authority; [contributor instructions](contributing.md) own independent publishing.

## Responsibilities and access

`CODEOWNERS` and repository permissions name the moderators; current policy names authorized maintainers and direct trusted accounts. The operator records an incident owner and GitHub failure-notification recipients in the handoff. Repository ownership alone does not prove notifications are configured. An untrusted outside contributor and a distinct authorized human moderator are required to rehearse the outside review path. A trusted-account rehearsal does not require that review.

The catalog read App has administration, contents, checks and pull-request read access to the selected catalog. Its key is in `CATALOG_READ_APP_PRIVATE_KEY`; its client ID is a repository variable. The separate publisher App has contents and pull-request write access, without administration; its key is in `CATALOG_PR_APP_PRIVATE_KEY` in the trusted publisher. Both workflows mint target-scoped short-lived tokens and revoke them afterward. Contributors use their own GitHub and npm authority, never these keys. Registry publication uses trusted publishing or the configured `NPM_TOKEN`. Record registry package/workflow scope separately from GitHub App scope.

## Find and retain a failure

Set the selected repository names, then list runs in the repository that owns the failed phase:

```sh
catalog_repository="<catalog-owner/catalog-repository>"
publisher_repository="<publisher-owner/publisher-repository>"
gh run list --repo "$publisher_repository" --workflow release.yml
gh run list --repo "$catalog_repository" --workflow check.yml
gh run list --repo "$catalog_repository" --workflow publish.yml
```

Inspect the chosen run and retain its artifacts in a new directory:

```sh
gh run view <run-id> --repo <owner/repository> --log-failed
gh run download <run-id> --repo <owner/repository> --dir <new-evidence-directory>
```

Record source SHA, attempt, submission identity and PR head/base alongside the diagnostics. Pack artifacts retain bytes, submission data and the installed catalog CLI lock. Assessment artifacts retain the input-bound report, dependency lock and preparation/cleanup logs. Index publication retains its receipt; durable evidence is also bundled in the index and linked from the evidence release. A failed or missing report is never reconstructed as a pass.

## Recover pack publication

An accepted upload is immutable. If `upload-accepted.json` exists, confirmation is unresolved, or an upload result is uncertain, never upload that version again. Inspect exact registry identity against retained bytes. A rerun of the original workflow uses `GITHUB_RUN_ATTEMPT > 1` and cannot upload:

```sh
gh run rerun <publisher-run-id> --repo "$publisher_repository" --failed
```

Its source, lock and rebuilt archive must still match the registry integrity. A mismatch refuses and needs investigation, not a changed version attached to old evidence. For retained-byte confirmation in a publisher that implements the retained-byte recovery command, use its exact checkout and retained `release/` directory; point `CATALOG_CLI` at the exact installed released CLI and run `node scripts/publish.mjs --confirm-only`. This path performs reads and writes its receipt without upload or proposal credentials.

Independent publishers may use different release tooling; they must preserve the same immutable bytes and read-only confirmation rule. The commands above describe the shipped Volter publisher workflow.

A new first-attempt dispatch can upload an absent version. Use it only after evidence proves a prior failure happened before upload, or for a newly prepared immutable version. It is not the recovery command for an accepted or uncertain upload.

Proposal recovery uses canonical retained submission JSON. The publisher workflow's `propose --send` returns the existing PR even if it is closed; it does not reopen it, approve it or create a duplicate. A rejected release is not silently resubmitted. Artifact fixes require a new version. A proposal transport failure needs no package upload.

## Recover assessment

Preparation confirms both the exact-version registry view and npm's installation view. Visibility can lag independently. Confirmation is bounded by the existing measured registry policy, performs reads only and checks exact integrity. Only 404 and an otherwise valid installation document missing that version are retried. Permission errors, malformed identities and conflicting bytes remain refusals.

For an infrastructure failure, explicitly reassess the current PR:

```sh
gh workflow run check.yml --repo "$catalog_repository" --ref main -f pr=<pr-number>
```

The job uses trusted current source and reads candidate data at the exact head. A changed head or base needs fresh evidence. Check the resulting report and current-head readiness; an older success or local report is insufficient. Candidate defects need a new immutable package version. The automation neither approves nor merges.

Untrusted-account submissions need genuine current-head non-author human moderator approval. Direct trusted-account contributions, including forks, and eligible internal changes may use the named maintainer exception; every path still requires current-head readiness. Verify the author against `policy.trustedAccounts` using GitHub ID, login and type. Never use administrator merge to bypass missing untrusted-account review or a failed check.

## Recover index publication

Retry current protected main after resolving the recorded cause:

```sh
gh workflow run publish.yml --repo "$catalog_repository" --ref main
```

The workflow verifies admission and protection, then reuses a published version only when source and digest match. It cannot overwrite a conflicting identity. Retain the new receipt and compare registry integrity before calling the upload confirmed. No platform build, candidate test or hosted deployment is part of this job.

## Recommend, reject or revoke

A moderator rejects a PR with a concrete reason. An unmerged readiness success adds no release to the index.

With multiple live implementations, change `recommendations.json` in a separate maintainer PR to select the package. Versions from different publishers never compete. Selection within that package offers its newest live stable approved release.

To withdraw an admitted release, append its exact package/version and a nonempty reason to `revocations.json` in a maintainer PR. Remove or replace a recommendation that would otherwise have no selectable release. After current-head readiness and moderator merge, index publication changes future defaults. It preserves immutable package bytes, prior evidence and existing World pins; it does not remotely uninstall a pack.

## Pause distribution and replace credentials

Pause future work without deleting artifacts or rewriting history:

```sh
gh variable set PACK_PUBLISH_ENABLED --repo "$publisher_repository" --body false
gh variable set CATALOG_PUBLISH_ENABLED --repo "$catalog_repository" --body false
```

These flags govern future jobs; they do not recall published packages or settle an in-flight upload. Preserve its receipts and inspect the outcome separately. Re-enable the intended flag only after the incident is resolved.

For an App key replacement, inventory selected repositories and consumers, generate an additional key, store it directly in the correct encrypted repository secret, and confirm the intended workflow's access before revoking the old key. Never print or commit a key, broaden an installation to every repository, or remove another consumer's key. Keep read and proposal roles separate. For npm replacement, use approved custody or trusted publishing and restrict package/workflow scope appropriately. Document identity, target and replacement outcome without secret values.
