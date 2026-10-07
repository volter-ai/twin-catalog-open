export type Coverage = {
  total: number;
  exercised: number;
  percent: number;
  operations: string[];
  missing: string[];
};
export type Replay = { equal: boolean; runs: number; firstSha256: string; secondSha256: string };
export type Measurements = {
  consumer: null | {
    measured: boolean;
    passed: boolean;
    scope: string | null;
    fixture: string | null;
    sdkDependencies: Record<string, string> | null;
    tools: Record<string, string> | null;
    clock: Record<string, unknown> | null;
    retainedReadback: boolean | null;
    retentionNotApplicable: string | null;
    teardownVerified: boolean | null;
    failures: string[] | null;
  };
  scope: string | null;
  surface: { total: number; served: number; gap: number } | null;
  operationCoverage: Coverage | null;
  servedOperations: string[] | null;
  steps: number | null;
  answered: number | null;
  failures: unknown[] | null;
  replay: Replay | null;
  conformance: Array<{ id: string; asks: string; failures: unknown[]; note?: string }> | null;
  browser: {
    measured: true;
    target: string;
    responseObservation?: string;
    applicationOriginCorsCoverage?: unknown | null;
    cookieJarCoverage?: unknown | null;
    version: string;
    answered?: number;
    failures?: unknown[];
    operationCoverage?: Coverage;
    replay?: Replay;
    domCoverage?: unknown | null;
    clock?: { native: string; nativePrecisionMs: number; javascriptPrecisionMs: number; monotonic: string };
  } | null;
  codeCoverage: unknown | null;
  stateTransitionCoverage: unknown | null;
  domCoverage: unknown | null;
  comparison: Record<string, unknown> | null;
};
export type Release = {
  version: string;
  status: 'live' | 'pending' | 'rejected';
  integrity?: string;
  commit?: string;
  at?: string;
  by?: string;
  reason?: string;
  submission?: string;
  assessmentCommit?: string;
  assessedAt?: string;
};
export type CatalogRelease = Release & {
  packageMetadata: null | {
    description: string | null;
    license: string;
    engines: Record<string, string>;
    peerDependencies: Record<string, string>;
    repositoryDirectory: string | null;
    bugs: string | null;
    sourceCommit: string | null;
    readmeUrl: string | null;
    licenseUrl: string | null;
    packageUrl: string;
    issuesUrl: string | null;
  };
  revoked: { reason: string } | null;
  selectable: boolean;
  default: boolean;
  assessment: {
    recorded: boolean;
    available: boolean;
    evidence: null | { submission: string; admissionCommit?: string; reportPath?: string; reportSha256?: string;
      url?: string; pullRequest?: number; moderation?: Record<string, unknown> };
    input: null | { repository: string; pullRequest: number; head: string; base: string; image?: string;
      workflow?: { repository: string; run: number; attempt: number; file: string };
      tools: Record<string, string> | null };
  };
  measurements: Measurements | null;
};
export type CatalogView = {
  schemaVersion: 1;
  snapshot: { package: string; version: string; integrity: string | null; sourceCommit: string; digest: string };
  contribution: { repository: string; registrationUrl: string; pullRequestsUrl: string; guideUrl: string };
  vendors: Array<{
    vendor: string;
    recommendation: string | null;
    selection: { state: 'selected' | 'unavailable-recommendation' | 'choice-required' | 'unavailable';
      default: { package: string; version: string; source: string } | null };
    implementations: Array<{
      package: string;
      source: { name: string; repository: string; scope: string; official: boolean; protocol: '3';
        workflow?: string; url: string; workflowUrl: string };
      versions: CatalogRelease[];
    }>;
  }>;
};
/** JSON-only installed-index reader. Does not fetch, import packs, assess, install or verify tarball integrity. */
export function browse(root: string, options?: { vendor?: string; package?: string; integrity?: string | null }): CatalogView;
