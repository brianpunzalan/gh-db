<!--
SYNC IMPACT REPORT
==================
Version Change: [none] → 1.0.0 (MAJOR: initial constitution ratification)

Modified Principles:
  N/A — initial adoption, all principles are new

Added Sections:
  - Core Principles (5 principles defined)
  - Quality Standards
  - Release Process
  - Governance

Removed Sections:
  N/A

Templates Requiring Updates:
  ✅ .specify/templates/plan-template.md — Constitution Check gates aligned with 5 principles
  ✅ .specify/templates/tasks-template.md — Test tasks updated from OPTIONAL to MANDATORY
  ✅ .specify/templates/spec-template.md — No structural changes needed; existing format compatible
  ⚠  .specify/templates/constitution-template.md — Source template; not modified (read-only reference)

Follow-up TODOs:
  - Configure eslint-plugin-jsdoc in CI to enforce Principle III automatically
  - Set up automated release workflow (GitHub Actions) to enforce Principle V
-->

# gh-db Constitution

## Core Principles

### I. Unit Testing (NON-NEGOTIABLE)

Every feature addition and bug fix MUST be accompanied by at least one unit test covering the
new or corrected behavior. Tests MUST reside in the project's designated test directory and MUST
be executable via the standard test runner. No change may be merged without passing unit tests.

**Rationale**: Untested code creates invisible regressions and erodes confidence in the codebase.
Unit tests serve as executable documentation and the first defense against breakage.

### II. Quality Gates (NON-NEGOTIABLE)

All code changes MUST pass the following automated quality gates before merging:

- **Unit Tests**: All tests pass (e.g., `npm test` or project-configured equivalent).
- **Lint**: Zero lint errors (e.g., ESLint with project `.eslintrc` or `eslint.config.js`).
- **Formatting**: Code conforms to the project formatter (e.g., Prettier) with no unresolved diff.

CI pipelines MUST enforce all three gates. Changes failing any gate MUST NOT be merged.

**Rationale**: Automated gates remove subjectivity, prevent quality debt, and reduce cognitive
overhead during code review.

### III. JSDoc Documentation (NON-NEGOTIABLE)

Every exported function, class, method, and module MUST have a complete JSDoc comment block
including at minimum:

- A clear description of purpose.
- `@param` entries for each parameter (type + description).
- `@returns` entry (use `@returns {void}` when applicable).

Non-trivial private/internal helpers SHOULD also be documented. JSDoc validation MUST be
enforced in CI (e.g., via `eslint-plugin-jsdoc`).

**Rationale**: JSDoc is the living API contract. It enables IDE tooling (type hints, autocomplete)
and prevents readers from needing to read implementations to understand interfaces.

### IV. Code Intent Comments (NON-NEGOTIABLE)

Each logical block of code MUST be preceded by a comment describing the *why* (intent, business
rule, or non-obvious constraint), not merely the *what*. Comments MUST stay synchronized with
their code. Stale or misleading comments MUST be corrected in the same PR that changes the code.

**Rationale**: Code expresses *what* happens; comments express *why*. Intent comments reduce
onboarding time and prevent future developers from accidentally reverting intentional decisions.

### V. Semantic Versioning & Changelog (NON-NEGOTIABLE)

Every change merged to the main branch MUST:

1. Trigger a `package.json` version bump following SemVer:
   - **MAJOR**: Breaking API or behavioral changes.
   - **MINOR**: Backward-compatible new functionality.
   - **PATCH**: Backward-compatible bug fixes and non-functional changes.
2. Log the change in `CHANGELOG.md` under the new version heading using Keep a Changelog format
   (sections: Added / Changed / Deprecated / Removed / Fixed / Security).

No release may be published without a corresponding `CHANGELOG.md` entry.

**Rationale**: Versioned releases allow consumers and contributors to reason about change scope.
A maintained CHANGELOG provides a human-readable audit trail that git history alone cannot.

## Quality Standards

The following standards apply uniformly across all modules in the codebase:

- **Test Coverage**: Unit tests MUST cover the primary success path and at least one failure or
  edge case per non-trivial function.
- **Lint Ruleset**: The project linter configuration is authoritative. Rule suppressions (e.g.,
  `// eslint-disable`) are NOT permitted without an inline justification comment and maintainer
  approval.
- **Formatter Configuration**: The project formatter config is authoritative. Per-file format
  overrides MUST NOT be introduced without team review.
- **JSDoc Enforcement**: Automated JSDoc validation (e.g., `eslint-plugin-jsdoc`) MUST be
  configured in CI to catch missing or malformed documentation before merge.
- **Dead Code**: Unused exports, unreachable branches, and commented-out code blocks MUST be
  removed before merge. Temporary workarounds MUST include a `// TODO:` with an issue reference.

## Release Process

All releases to the main branch follow this mandatory process:

1. **Version Bump**: Update `version` in `package.json` following SemVer (Principle V).
2. **Changelog Entry**: Add a new dated version section to `CHANGELOG.md` listing all changes
   since the previous release under the appropriate Keep a Changelog category headings.
3. **Git Tag**: Create a git tag of the form `vMAJOR.MINOR.PATCH` on the merge commit.
4. **GitHub Release**: Release notes MUST mirror the corresponding `CHANGELOG.md` section.
5. **Automation**: The release pipeline SHOULD be automated via CI (e.g., a release workflow
   triggered on main-branch merges when `package.json` version has changed).

Hotfixes follow the same process; patch versions MUST be incremented, not skipped.

## Governance

This constitution supersedes all prior informal coding practices and style agreements for the
`gh-db` project. Amendments require:

1. A written proposal describing the change, rationale, and impact on existing code.
2. Review and approval by at least one project maintainer.
3. A migration plan for any existing code that violates the new rule.
4. A constitution version bump and `CHANGELOG.md` entry.

All pull requests and code reviews MUST verify compliance with these principles. Deviations or
complexity exceptions MUST be justified in the PR description. This file
(`.specify/memory/constitution.md`) is the authoritative governance reference.

**Version**: 1.0.0 | **Ratified**: 2026-05-20 | **Last Amended**: 2026-05-20
