# Contributing

Thank you for contributing to the Cloudsmith Yarn plugin.

## Project layout

| Path | Contents |
|------|----------|
| `sources/cli.ts` | Code that runs the Cloudsmith CLI and reads its output. |
| `sources/credentials.ts` | Code that decides which registries get the CLI credential, and caches the answers of the CLI. |
| `sources/index.ts` | The Yarn plugin: the `getNpmAuthenticationHeader` hook. |
| `build.ts` | The build of the plugin bundle, `bundles/yarn-plugin-cloudsmith-auth.cjs`. |
| `test/` | The unit tests. |
| `test/e2e/` | Tests that run real Yarn commands against a local HTTPS npm registry. |
| `examples/` | A library and an app that publish to and install from a real Cloudsmith repository. |

## Design rules

- **No runtime dependencies.** Yarn loads the plugin as one file, and gives it
  only the Node.js builtins and the Yarn modules. The plugin uses
  `@yarnpkg/core` and `@yarnpkg/plugin-npm` from Yarn, and bundles nothing
  else. Logic that needs more belongs in the
  [Cloudsmith CLI](https://github.com/cloudsmith-io/cloudsmith-cli).
- **Yarn 3.1 and Node.js 18 are the minimum.** The build targets Node.js 18,
  and removes the `node:` prefix from builtin imports, because Yarn 3 and
  Yarn 4.0 do not give plugins the builtins by that name.
- **Fail silently.** Every CLI failure makes the plugin step aside, so Yarn
  behaves as if the plugin were not installed. The hook throws nothing.
- **Trust few hosts.** The plugin sends the credential only over HTTPS, to a
  host that `cloudsmith domains list` reports. Treat a change to that check as
  a security change.
- **Strict types.** `tsconfig.json` turns on every strict check. Do not add
  `any`, type assertions on CLI output, or suppression comments.

## Prerequisites

[mise](https://mise.jdx.dev/) installs the pinned Node.js, Yarn, Cloudsmith
CLI, and tools. Install mise as the
[mise documentation](https://mise.jdx.dev/getting-started.html) describes, then
run:

```sh
git clone git@github.com:cloudsmith-labs/yarn-plugin-cloudsmith-auth.git
cd yarn-plugin-cloudsmith-auth
mise install
mise run hooks    # Run the checks before each commit.
```

## Build from source

```sh
mise run build
yarn plugin import /path/to/yarn-plugin-cloudsmith-auth/bundles/yarn-plugin-cloudsmith-auth.cjs
```

Run `yarn plugin import` in the root of the project that uses the plugin.

## Test

| Command | What it runs |
|---------|--------------|
| `mise run test` | The type check and the unit tests |
| `mise run test:e2e` | The e2e tests |
| `mise run verify` | Every test |

The unit tests replace the CLI with fakes and use no network. The e2e tests
import the bundle with `yarn plugin import`, as a user does. Then they run
`yarn install` and `yarn npm publish` against a local HTTPS npm registry that
requires authentication, with a shell script in place of the CLI. The e2e
tests need `openssl` to make the certificate of the registry, and do not run
on Windows.

The e2e tests use the Yarn on `PATH`, on the Node.js that runs the tests. To
test other versions, as CI does:

```sh
mise install yarn@3.1.1 node@18.20.8
IT_YARN_HOME="$(mise where yarn@3.1.1)" IT_NODE_HOME="$(mise where node@18.20.8)" \
    mise run test:e2e
```

`test/cli.test.ts` reads `test/fixtures/domains_list_v1.json`, the output of a
real `cloudsmith domains list`. Record it again when the CLI contract changes.
The CLI must be signed in:

```sh
env -u CLOUDSMITH_WORKSPACE -u CLOUDSMITH_ORG cloudsmith domains list \
    | python3 -m json.tool > test/fixtures/domains_list_v1.json
```

Remove the custom domains of your own workspace from the fixture.

## Run the examples

The examples publish a library to a Cloudsmith repository and then install it
in an app. See [examples/README.md](./examples/README.md).

The Examples workflow runs them for each target in the `EXAMPLE_TARGETS`
repository variable, a JSON list. Each target authenticates with GitHub Actions
OIDC, so the repository stores no Cloudsmith token:

```json
[
  {
    "name": "cloudsmith.io hosts",
    "workspace": "WORKSPACE",
    "repository": "REPOSITORY",
    "service": "SERVICE_ACCOUNT_SLUG"
  },
  {
    "name": "custom domain",
    "workspace": "WORKSPACE",
    "repository": "REPOSITORY",
    "service": "SERVICE_ACCOUNT_SLUG",
    "registry_url": "https://HOST/REPOSITORY/",
    "resolve_latest": true
  }
]
```

Cloudsmith processes an upload before it serves it, and some workspaces take
longer than the 15 minutes that the examples wait. For such a target, set
`resolve_latest`. The app then installs the newest version that Cloudsmith has
processed, not the version that the run published.

Each service account needs write access to its repository and an OIDC provider
that trusts this GitHub repository. Without `EXAMPLE_TARGETS`, the workflow
skips the examples.

## Lint and format

[Biome](https://biomejs.dev/) formats and lints the TypeScript and the JSON.
[zizmor](https://docs.zizmor.sh/) audits the workflows,
[gitleaks](https://github.com/gitleaks/gitleaks) scans for secrets, and
[typos](https://github.com/crate-ci/typos) checks spelling.
[prek](https://github.com/j178/prek) runs them all from
`.pre-commit-config.yaml`.

```sh
mise run format    # Format and fix every file.
mise run lint      # Run every check that the CI Lint job runs.
mise run secrets   # Scan the working tree and the full history for secrets.
```

The `gitleaks` hook scans staged changes only, so it reads nothing during
`mise run lint`. The Security workflow and `mise run secrets` scan everything.

## Commit messages and pull requests

Write commit messages and pull request titles as
[Conventional Commits](https://www.conventionalcommits.org/), for example
`fix: skip registries without a host`. release-please builds the version and
the changelog from them:

| Type | Effect on the next release |
|------|----------------------------|
| `feat` | New minor version, listed under Features |
| `fix` | New patch version, listed under Bug Fixes |
| `feat!` or a `BREAKING CHANGE:` footer | New major version (minor before 1.0) |
| `docs`, `refactor`, `test`, `build`, `ci`, `chore` | No release |

Squash-merge pull requests, so that the title becomes the commit message.

Each change in behavior needs a test. To report a security issue, see
[SECURITY.md](./SECURITY.md).
