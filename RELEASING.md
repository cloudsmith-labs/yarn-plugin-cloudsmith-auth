# Releasing

[release-please](https://github.com/googleapis/release-please) automates
releases.

## How a release happens

1. Pull requests merge to `main` with
   [Conventional Commits](https://www.conventionalcommits.org/) titles. See
   [CONTRIBUTING.md](./CONTRIBUTING.md#commit-messages-and-pull-requests).
2. On each push to `main`, the Release workflow opens or updates a release
   pull request named `chore(main): release X.Y.Z`. It sets the version in
   `package.json` and in the download URLs of `README.md`, and adds the release
   notes to `CHANGELOG.md`.
3. Review the release pull request, then merge it.
4. The Release workflow creates the `vX.Y.Z` tag and the GitHub release, and
   then runs each publish job that is turned on:

   | Job | Publishes | Runs when |
   |-----|-----------|-----------|
   | GitHub | The bundle, attached to the GitHub release | Always |
   | Cloudsmith | The bundle, as the raw package `yarn-plugin-cloudsmith-auth` | `RELEASE_CLOUDSMITH_REPO` is set |

5. Confirm that each destination shows the new version. Then run
   `yarn plugin import` with the URL from `README.md` in a test project.

Each publish job runs a mise task, so you can run the same step locally. A
failed job can be run again from the workflow run page.

## Set up GitHub

1. In **Settings > Actions > General**, select
   **Allow GitHub Actions to create and approve pull requests**.
2. Add the `CLOUDSMITH_BOT_PR_TOKEN` secret. release-please opens the release
   pull request with this token, so CI runs on it. Without the secret,
   release-please uses the default token, and CI does not run on the release
   pull request. The Dependabot auto-merge workflow uses the same token.
3. Protect `main` and make the CI checks required. The Dependabot auto-merge
   workflow waits for the required checks.

## Set up Cloudsmith

The release job authenticates to Cloudsmith with GitHub Actions OIDC.

1. Create a public Cloudsmith repository for releases. `README.md` gives the
   URLs of the `cloudsmith/yarn-tools` repository.
2. Create a service account with write access to the repository.
3. Add a GitHub Actions OIDC provider with the claims `repository` set to this
   GitHub repository and `ref` set to `refs/heads/main`, and map it to the
   service account. The `ref` claim stops other branches from publishing.
4. Set these repository variables:

   | Variable | Value |
   |----------|-------|
   | `RELEASE_CLOUDSMITH_ORG` | The workspace |
   | `RELEASE_CLOUDSMITH_REPO` | The repository |
   | `RELEASE_CLOUDSMITH_SERVICE_SLUG` | The service account slug |

To try it locally against a test repository:

```sh
CLOUDSMITH_ORG=WORKSPACE CLOUDSMITH_REPO=REPOSITORY mise run publish:cloudsmith
```

## Version scheme

This project follows [Semantic Versioning](https://semver.org/). A breaking
change to the behavior of the plugin, to its environment variables, or to the
Yarn or Node.js versions that it supports, increases the major version. Before
1.0, a breaking change increases the minor version.
