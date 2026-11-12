# Output shapes

Every research command with `--json` returns the envelope below. These are structural schemas in
TypeScript notation: `?` means a field may be absent, `| null` means explicitly unknown, and `[]` is an
array. Primary-source failures can leave only the base record. Do not treat absent fields as zero.

```ts
type Envelope = { schema_version: 1; generated_at: string; goal: string | null; data: Result };
type Result = Project | Profile | Comparison | Search | Alternatives | Maintainers | ResolvedProjects;
type Project = GitHub | Npm | Crate;
type Status = 'ok' | 'unavailable';
type Base = { kind: string; id: string; url: string | null; sources: Source[]; warnings: string[] };
type Source = {
  url: string; observed_at: string; cached: boolean; fields: string[];
  final_url?: string; redirects?: { from: string; to: string; status: number }[];
  next_page: boolean; last_page: number | null;
};
type Readme = { text?: string; url: string; truncated: boolean; untrusted: true; omitted?: true };
type RepositoryLink = string | { url?: string; type?: string; directory?: string } | null;
type RepoSummary = {
  id: string; url: string; description?: string | null; stars: number | null; forks: number | null;
  language?: string | null; pushed_at?: string | null; archived: boolean | null;
  is_fork: boolean | null; license: string | null;
};
type Owner = {
  login: string; type: string; url?: string; role: 'repository_owner';
  administrative_control: true | null;
};
type Contributor = {
  login: string | null; type: string; contributions: number; url: string | null; relationship: string;
};
type CreatorInference = {
  status: 'inferred'; candidate: string; claim: 'likely self-authored';
  basis: string[]; sources: string[]; limitations: string;
};
type Dependencies = {
  runtime: number; development: number; optional: number; peer?: number; build?: number;
  scope: string; source: string; note?: string;
};
type Publication = {
  first_published_at: string | null; version_published_at: string | null;
  registry_created_at: string | null; published_at: string | null; published_at_scope: string;
};
```

## Projects

`inspect` returns one of these for an explicit project reference. A package's `repository` is an
independent GitHub record with its own status and sources. Conversely, GitHub can have verified linked
`packages` or unverified `package_hints[].evidence`. Failure of either service preserves the other evidence.

```ts
type GitHub = Base & Partial<RepoSummary> & {
  kind: 'github'; status: Status; requested_id?: string; homepage?: string | null;
  owner?: Owner; topics?: string[]; created_at?: string | null; supported_platforms?: null;
  activity_note?: string; open_issues_and_pull_requests?: number | null;
  languages?: Record<string, number> | null;
  release?: { tag: string; published_at?: string | null; url: string } | null;
  contributors?: { sampled: number; total: null; has_more: boolean; people: Contributor[]; note: string } | null;
  readme?: Readme | null; creator_inference?: CreatorInference | null;
  package_hints?: { kind: 'npm'; id: string; source: string; relationship: string; evidence?: Npm }[];
  packages?: (Npm & { relationship: string })[]; quality?: Quality; assessment?: Assessment;
};
type Npm = Base & Partial<Publication> & {
  kind: 'npm'; status: Status; description?: string | null; version?: string | null;
  license?: unknown; deprecated?: string | null; homepage?: string | null; keywords?: string[];
  repository_link?: RepositoryLink; declared_maintainers?: { name: string }[];
  declared_maintainers_scope?: 'current_registry_metadata' | 'selected_version_metadata' | null;
  platform_constraints?: { os: unknown; cpu: unknown; engines: Record<string, string> | null };
  supported_platforms?: null; dependencies?: Dependencies | null; readme?: Readme | null;
  downloads?: {
    count: number; start: string; end: string; metric: 'npm downloads'; note: string;
    window_days?: number; days_since_publication_in_window?: number;
    window_precedes_first_publication?: boolean;
  } | null;
  repository?: GitHub | null; repository_directory?: string | null; assessment?: Assessment;
};
type Crate = Base & Partial<Publication> & {
  kind: 'crate'; status: Status; description?: string | null; version?: string; license?: string | null;
  homepage?: string | null; repository_link?: RepositoryLink; keywords?: string[]; supported_platforms?: null;
  downloads?: {
    count: number | null; metric: 'crates.io lifetime downloads'; start: string | null; end: null;
    recent_count: number | null; recent_window: string; note: string;
  };
  dependencies?: Dependencies | null; repository?: GitHub | null;
  repository_directory?: string | null; assessment?: Assessment;
};
type Quality = {
  open_pull_requests: number | null; open_issues: number | null; issue_count_basis: string;
  latest_workflow_run: {
    name?: string; status: string; conclusion?: string | null; head_sha: string;
    branch?: string; url: string; updated_at?: string;
  } | null;
  ci_scope: string;
  tests: {
    status: 'files_detected' | 'script_declared' | 'not_established'; matching_paths: string[];
    tree_truncated: boolean | null; note: string; declared_test_script?: string | null;
  };
  workflow_paths: string[]; dependencies: Dependencies | null;
};
```

`--details` adds `quality` to GitHub records and `dependencies` to crate records. npm dependency counts
are collected without that flag. `--no-readme` removes `Readme.text`, retaining metadata and `omitted: true`.

## Comparisons, searches, and alternatives

```ts
type Comparison = {
  kind: 'comparison'; projects: Project[]; resolutions: Omit<ResolvedProjects, 'results'>[]; warnings: string[];
};
type SearchCandidate =
  | (RepoSummary & { ref: string })
  | { id: string; ref: string; url: string; description: string | null; version?: string; registry_score: unknown }
  | { id: string; ref: string; url: string; description: string | null; downloads: number | null };
type Search = Base & {
  kind: 'search'; ecosystem: 'github' | 'npm' | 'crate'; status: Status;
  candidates: SearchCandidate[]; total_matches: number | null; incomplete?: boolean | null;
};
type Alternatives =
  | (Omit<Search, 'kind'> & { kind: 'alternatives'; seed: Project; query: string })
  | { kind: 'alternatives'; seed: Project; status: 'unavailable'; candidates: [] };
```

The minimal alternatives variant is returned when the seed is unavailable. Comparisons keep useful
projects even when other inputs fail; failed bare-name lookups remain visible in `resolutions`.

## Profiles and maintainers

```ts
type Profile = Base & {
  kind: 'profile'; status: Status; name?: string | null; bio?: string | null;
  account_type?: string; created_at?: string;
  notable_repositories?: RepoSummary[];
  selection?: {
    repositories: string; contribution_samples: string; incomplete: boolean | null;
    repository_sample_truncated: boolean | null; external_pr_sample_truncated: boolean | null;
    external_issue_sample_truncated: boolean | null; repository_matches: number | null;
    external_pr_matches: number | null; external_issue_matches: number | null;
  };
  external_contributions?: {
    title: string; url: string; repository: string | null; type: 'pull_request' | 'issue';
    state: string; created_at?: string; updated_at?: string; merged: boolean | null;
  }[];
  recent_external_activity?: { type: string; repository: string; date?: string; url: string }[];
  recent_activity_coverage?: string;
};
type Maintainers = {
  kind: 'maintainers'; project: Project; owner: Owner | null; creator: null;
  creator_inference: CreatorInference | null;
  documented_maintainer_evidence: { text: string; line: number; url: string; interpretation: string }[];
  contributor_candidates: Contributor[]; profiles: Profile[]; profile_selection: string;
  package_maintainers: { name: string; registry?: 'npm'; package?: string; source?: string }[];
  sources: Source[]; warnings: string[];
};
```

`maintainers --details` combines the widest set of factual evidence: package, repository, quality signals,
relationship excerpts, and profiles. Model assessments are not available for this workflow.

## Bare repository names

```ts
type ResolvedProjects = Base & {
  kind: 'resolved_projects'; workflow: 'inspect' | 'maintainers' | 'alternatives'; status: Status;
  inferred: true; activity_basis: string; coverage: string; incomplete: boolean;
  candidates: (RepoSummary & { ref: string; selected_by: ('most_starred' | 'most_active')[] })[];
  results: (Project | Maintainers | Alternatives)[];
};
```

`candidates` contains up to two distinct matches. `results` follows the same order. Selection considers
exact repository names in the returned search pages, preferring non-forks; activity uses `pushed_at`.
Agents must disclose the inferred identity, show both matches when different, and explain which they use.
This disclosure is required even when both selection criteria identify the same repository.

## Optional Jev assessment

```ts
type Assessment =
  | { status: 'unavailable'; error: string }
  | { status: 'dry_run'; sent: false; request: JevRequest; request_readme_text_omitted?: true }
  | {
      status: 'ok'; interpretation: 'evidence_available' | 'insufficient_evidence' | 'uncertain_evidence';
      model: string; observed_at: string; note: string; usage: unknown;
      answers: {
        documented_fit: { type?: 'score'; score: number; probabilities: Record<'0' | '1' | '2', number>; confidence?: number; legend?: unknown };
        evidence_sufficient: { type?: 'noul'; noul: number };
      };
    };
type JevRequest = {
  model: string;
  state: {
    goal: string;
    project: {
      id: string; ecosystem: 'github' | 'npm' | 'crate'; description?: string | null;
      package_readme: Readme | null; repository_readme: Readme | null; repository_directory: string | null;
      platform_constraints: Npm['platform_constraints'] | null; sources: Source[]; warnings: string[];
    };
  };
  questions: {
    documented_fit: { type: 'score'; instructions: string; criteria: string[] };
    evidence_sufficient: { type: 'noul'; instructions: string; criteria: { true: string; false: string } };
  };
};
```

Assessment fields appear on individual projects, including projects within name resolutions and comparisons.
Dry runs preview the request; they contain no model answers. Unknown upstream extensions may be retained
inside model answers, usage, license metadata, and registry scores.

## Failures and non-research commands

- Source failures produce `warnings` and partial records in the same envelope. There is no separate JSON
  error envelope. Exit 1 can still contain useful evidence.
- Usage errors and unexpected exceptions print a message to stderr and produce no JSON; exit 2 means
  invalid input, exit 1 means an operational failure. A failed name lookup is exit 1, not a usage error.
- `--help`, `--version`, and `install-skill` return text, including when `--json` accompanies help/version.
- Markdown presents the same collected evidence selectively; it is not a lossless JSON serialization.
  `--no-evidence` suppresses the normal README excerpts in Markdown; `--no-readme` also removes README
  text from nested JSON records and Jev previews.
