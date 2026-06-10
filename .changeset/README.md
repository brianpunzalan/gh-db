# Changesets

This directory is managed by [changesets](https://github.com/changesets/changesets).

You normally do **not** need to add changeset files by hand. The release
pipeline (`.github/workflows/release.yml`) generates a changeset automatically
from the conventional-commit history on every push to `main`, then versions,
builds, and publishes the package to the NPM registry.

Conventional commit → semver bump:

| Commit prefix                               | Bump    |
| ------------------------------------------- | ------- |
| `feat!:` / `fix!:` / `BREAKING CHANGE:`     | `major` |
| `feat:`                                     | `minor` |
| `fix:` / `perf:` / `refactor:` / everything | `patch` |

If you want to add a changeset manually, run `npm run changeset`.
