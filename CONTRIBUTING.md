# Contributing Guidelines

Thank you for contributing to `gemiredmine`!

## Git Workflow

We use a strict Git workflow to ensure code quality and automated release tracking.

### 1. Conventional Commits
All commits to this repository **must** follow the [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) specification.

Examples of valid commit messages:
*   `feat: add multiple server connection manager`
*   `fix(auth): prevent token leakage in logs`
*   `docs: update readme with setup instructions`
*   `chore(deps): update dependency react to v18`

This is enforced via a `commit-msg` git hook using `commitlint`.

### 2. Pre-Commit Hooks
Before a commit is allowed, automated tests and checks will run via a `pre-commit` hook.
You must ensure your code passes all tests locally before committing. The hook will execute tests automatically to prevent breaking changes from being committed.

### 3. Changelog Generation
We use standard tooling to automatically generate `CHANGELOG.md` based on the commit history.
Before creating a new version tag (e.g., cutting a release), the changelog **must** be updated.

The process for a maintainer to cut a release:
1. Run the release script (e.g., `npm run release`) which will:
   - Bump the version in package files.
   - Generate/update the `CHANGELOG.md` from the commit history.
   - Create a commit for the release.
   - Create a git tag for the new version.
2. Push the commits and tags to the repository.
