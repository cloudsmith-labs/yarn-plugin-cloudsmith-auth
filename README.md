# Cloudsmith Yarn plugin

Authenticate Yarn to [Cloudsmith](https://cloudsmith.io) npm registries with
the credential helper of the Cloudsmith CLI. Projects need no `npmAuthToken`
in `.yarnrc.yml` and no token in environment variables.

The same setup works with a SAML session on a laptop, OIDC in CI, and an API
key.

## How it works

Yarn asks the plugin for the credential of each npm registry that it
authenticates to:

1. Run `cloudsmith domains list` to learn which hosts serve Cloudsmith npm
   registries, including the custom domains of your workspace.
2. For a registry on one of those hosts, run
   `cloudsmith credential-helper generic` and send the credential as Basic
   auth.
3. Leave every other registry unchanged.

If the CLI is missing, not authenticated, or fails, Yarn runs as if the plugin
were not installed, and prints a warning with the error of the CLI. The CLI's
answers are kept in memory for five minutes, so a Yarn command runs the CLI
only a few times.

## Prerequisites

- Yarn 3.1 or later, on Node.js 18 or later. Yarn 1 (Classic) does not load
  plugins.
- The [Cloudsmith CLI](https://docs.cloudsmith.com/developer-tools/cli) 1.22.0
  or later on `PATH`, authenticated with `cloudsmith auth login`, OIDC, or
  `CLOUDSMITH_API_KEY`. Run `cloudsmith whoami` to confirm that the CLI is
  connected.
- For custom domains, a workspace that the CLI knows. Set
  `CLOUDSMITH_WORKSPACE`, or `workspace` in the CLI's `config.ini`.

## Where to get it

Releases are published to the public Cloudsmith repository
[`cloudsmith/yarn-plugins`](https://cloudsmith.io/~cloudsmith/repos/yarn-plugins/packages/),
and attached to each
[GitHub release](https://github.com/cloudsmith-labs/yarn-plugin-cloudsmith-auth/releases).
Downloads from Cloudsmith need no credentials. To build from source instead,
see [CONTRIBUTING.md](./CONTRIBUTING.md).

## Install the plugin

Install the plugin in one project, or for every project of a user.

**One project:** run this in the root of the project, and commit the changes
to `.yarnrc.yml` and `.yarn/plugins`:

<!-- x-release-please-start-version -->
```sh
yarn plugin import https://dl.cloudsmith.io/public/cloudsmith/yarn-plugins/raw/names/yarn-plugin-cloudsmith-auth/versions/0.1.0/yarn-plugin-cloudsmith-auth.cjs
```
<!-- x-release-please-end -->

**Every project:** download the plugin, and list it in `~/.yarnrc.yml`. Yarn
loads the plugins of `~/.yarnrc.yml` in every project:

<!-- x-release-please-start-version -->
```sh
mkdir -p ~/.yarn/plugins
curl -fsSL -o ~/.yarn/plugins/yarn-plugin-cloudsmith-auth.cjs \
    https://dl.cloudsmith.io/public/cloudsmith/yarn-plugins/raw/names/yarn-plugin-cloudsmith-auth/versions/0.1.0/yarn-plugin-cloudsmith-auth.cjs
```
<!-- x-release-please-end -->

```yaml
# ~/.yarnrc.yml
plugins:
  - path: .yarn/plugins/yarn-plugin-cloudsmith-auth.cjs
```

Yarn resolves the path from the directory of `~/.yarnrc.yml`.

## Use your Cloudsmith registry

Add your Cloudsmith registry to `.yarnrc.yml`. No `npmAuthToken` or
`npmAuthIdent` is needed.

**Scoped packages:** Yarn asks the plugin for a credential for each scoped
package:

```yaml
npmScopes:
  acme:
    npmRegistryServer: "https://npm.cloudsmith.io/WORKSPACE/REPOSITORY/"
```

**Every package:** Yarn asks for a credential for a package without a scope
only when `npmAlwaysAuth` is `true`:

```yaml
npmRegistryServer: "https://npm.cloudsmith.io/WORKSPACE/REPOSITORY/"
npmAlwaysAuth: true
```

To fetch every package through Cloudsmith, add the npm registry as an upstream
of your Cloudsmith repository.

**Publish:** `yarn npm publish` always asks for a credential. It publishes to
`npmPublishRegistry`, or else to the registry of the package:

```yaml
npmPublishRegistry: "https://npm.cloudsmith.io/WORKSPACE/REPOSITORY/"
```

**Credentials in the configuration take precedence.** The plugin steps aside
when Yarn has an `npmAuthToken` or an `npmAuthIdent` for the registry, so a
token in `.yarnrc.yml` overrides the CLI. A token at the top level of
`.yarnrc.yml` applies to every registry.

## Repository URLs

A custom domain belongs to one workspace, so its URLs leave out the workspace.

| `cloudsmith.io` host                              | Custom domain              |
| ------------------------------------------------- | -------------------------- |
| `https://npm.cloudsmith.io/WORKSPACE/REPOSITORY/` | `https://HOST/REPOSITORY/` |

## Configuration

| Variable                  | Default | Description                                                                                                                                 |
| ------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLOUDSMITH_CLI_PATH`     | Not set | Path to the `cloudsmith` executable. When set, `PATH` is not searched.                                                                      |
| `CLOUDSMITH_YARN_TIMEOUT` | `30`    | Time limit, in seconds, for each CLI command.                                                                                               |
| `CLOUDSMITH_YARN_TTL`     | `300`   | How long, in seconds, an answer from the CLI is reused. Failed answers are reused too, so a slow or broken CLI does not stall each request. |

## Use in CI

The CLI gets a token through OIDC in GitHub Actions. Give the job the
`id-token: write` permission, and set the workspace and the service account.
`CLOUDSMITH_WORKSPACE` makes the CLI list the custom domains of the workspace:

```yaml
permissions:
  contents: read
  id-token: write
env:
  CLOUDSMITH_ORG: WORKSPACE
  CLOUDSMITH_WORKSPACE: WORKSPACE
  CLOUDSMITH_SERVICE_SLUG: SERVICE_ACCOUNT_SLUG
```

## Troubleshooting

If the CLI is missing or fails, Yarn prints a warning that starts with
`Cloudsmith:` and shows the error of the CLI. Behind a TLS-intercepting proxy,
set `REQUESTS_CA_BUNDLE` to a CA bundle that contains the proxy CA.

If Yarn gets a 401 response and prints no warning, check these items:

```sh
yarn plugin runtime                                          # Is the plugin loaded?
cloudsmith domains list                                      # Is the host listed?
cloudsmith credential-helper generic > /dev/null && echo ok  # Is there a credential?
```

- A package without a scope needs `npmAlwaysAuth: true`.
- An `npmAuthToken` or `npmAuthIdent` in any `.yarnrc.yml`, including
  `~/.yarnrc.yml`, takes precedence over the CLI.

Known limitations:

- Windows is not tested in CI.

## Security

- The credential is sent only over HTTPS, and only to hosts that
  `cloudsmith domains list` reports as download or npm hosts.
- The CLI runs without a shell. Relative `PATH` entries are skipped, because
  they resolve against the project directory, which is often an untrusted
  checkout. On Windows, only `cloudsmith.exe` is accepted.
- The plugin never writes the token to disk or logs it.

To report a vulnerability, see [SECURITY.md](./SECURITY.md).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) to build and test the project, and
[RELEASING.md](./RELEASING.md) for the release process.

## License

Apache-2.0. See [LICENSE](./LICENSE).
