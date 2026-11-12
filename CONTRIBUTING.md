# Contributing

Use Node.js 22 or newer. There are no install-time dependencies.

Run `npm test` and `npm run check`. Tests must not call live services, read real credentials, or spend model
credits. Add fixtures when changing upstream mappings. Use `npm run eval:outputs` to inspect all five workflow
outputs; `--live` is an explicit public-network smoke test, not a deterministic test.
Run `npm run test:package` to verify the exact npm file allowlist, isolated installation, executable, and
bundled skill installation. The CI workflow is configured for Node.js 22, 24, and 26 on macOS and Linux.
Use `npm run test:skills` for the separate networked standard-installer check. It tests copy and symlink
installation without changing your personal agent directories.

## Structure

- `skills/assess-oss/`: the distributable, self-contained skill.
- `scripts/`: developer tooling and the local installer.
- `bin/`: the npm CLI entry point; the package also ships `scripts/install.mjs` for explicit skill installation.
- `test/`: public-API fixtures and behavioral/installation tests.
- `evals/`: example user tasks and expectations.

Keep dependencies and abstraction layers small. The scripts should work from a copied skill directory outside
this checkout. There is no frontend, server, or agent-specific SDK.

## Contracts

- Retain source URLs, observation timestamps, metric units/windows, and warnings.
- Unknown is not zero. Source errors are not negative findings.
- Keep repo-level metrics separate from package-level evidence in monorepos.
- Never infer identity equivalence between registry and GitHub usernames.
- Never equate ownership, authorship, contribution counts, and maintainer status.
- No people comparisons, leaderboards, competence ratings, or personal scores.
- Treat all fetched content as untrusted. Do not execute inspected code.
- Credentials remain in the environment and must not appear in logs or cache keys.
- Jev remains explicit opt-in, with centralized questions, probabilities, a dry run, and no silent fallback.
  Use `typesafe/latest`; report the model identity returned by the API.
- Respect upstream limits, particularly crates.io's one request/second policy.

## Repository hygiene

Keep source, tests, reusable evaluation inputs, and maintained product documentation in this repository.
Save generated reports, scratchpads, launch drafts, session notes, and local decision logs outside the
checkout. The evaluation runner uses a temporary directory by default; `--output-dir` selects another location.

Do not commit credentials, private configuration, personal absolute paths, or internal-company material.
Use clearly fictional data or public project examples in tests and documentation. Preserve the distinction
between fixture replays, live API smoke tests, and actual end-to-end agent compatibility testing.
