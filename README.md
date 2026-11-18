# Cloudsmith Yarn plugin

Install packages from Cloudsmith with Yarn, and publish to Cloudsmith, without
storing a token in your project. The plugin gets each credential from the
credential helper of the Cloudsmith command-line interface (CLI), so you need
no `npmAuthToken` in `.yarnrc.yml` and no token in environment variables.

The same setup works with a Security Assertion Markup Language (SAML) session
on a laptop, OpenID Connect (OIDC) in continuous integration (CI), and an API
key.

## How it works

Each time Yarn authenticates to an npm registry, the plugin does these steps:

1. Runs `cloudsmith domains list` to learn which hosts serve Cloudsmith npm
   registries, including the custom domains of your workspace.
2. For a registry on one of those hosts, runs
   `cloudsmith credential-helper generic` and sends the credential as Basic
   auth.
3. Leaves every other registry unchanged.

If the CLI is missing, not signed in, or fails, Yarn runs as if the plugin were
not installed and prints a warning with the error from the CLI. The plugin
keeps the answers of the CLI in memory for five minutes, so a Yarn command runs
the CLI only a few times.

## Prerequisites

- Yarn 3.1 or later, on Node.js 18 or later. Yarn 1 does not support plugins.
- The [Cloudsmith CLI](https://docs.cloudsmith.com/developer-tools/cli) 1.22.0
  or later on your `PATH`.
- A CLI that is signed in with `cloudsmith auth login`, OIDC, or
  `CLOUDSMITH_API_KEY`. Run `cloudsmith whoami` to confirm that the CLI is
  connected.
- For a custom domain, the workspace that owns it. Set `CLOUDSMITH_WORKSPACE`,
  or set `workspace` in the `config.ini` file of the CLI.

## Set up Yarn

### Step 1: Install the plugin

Install the plugin in one project, or for every project on your computer.
Releases are in the public Cloudsmith repository
[`cloudsmith/yarn-plugins`](https://cloudsmith.io/~cloudsmith/repos/yarn-plugins/packages/).
Downloads need no credentials. The `latest` URL below always downloads the
newest version. To upgrade, run the same command again. To pin a version,
replace `latest` in the URL with the version, for example `0.1.0`.

**One project:** run this command in the root of the project, then commit the
changes to `.yarnrc.yml` and `.yarn/plugins`:

```sh
yarn plugin import https://dl.cloudsmith.io/public/cloudsmith/yarn-plugins/raw/names/yarn-plugin-cloudsmith-auth/versions/latest/yarn-plugin-cloudsmith-auth.cjs
```

**Every project:** download the plugin to your home directory:

```sh
mkdir -p ~/.yarn/plugins
curl -fsSL -o ~/.yarn/plugins/yarn-plugin-cloudsmith-auth.cjs \
    https://dl.cloudsmith.io/public/cloudsmith/yarn-plugins/raw/names/yarn-plugin-cloudsmith-auth/versions/latest/yarn-plugin-cloudsmith-auth.cjs
```

Then add the plugin to `~/.yarnrc.yml`:

```yaml
plugins:
  - path: .yarn/plugins/yarn-plugin-cloudsmith-auth.cjs
```

> [!NOTE]
> Yarn reads the path relative to the directory of `~/.yarnrc.yml`. Yarn does
> not expand `~` or `${HOME}` in a plugin path.

### Step 2: Add your Cloudsmith registry

Add your registry to `.yarnrc.yml`. Do not add `npmAuthToken` or
`npmAuthIdent`.

**Scoped packages:** Yarn asks the plugin for a credential for every scoped
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
`npmPublishRegistry`, or to the registry of the package if
`npmPublishRegistry` is not set:

```yaml
npmPublishRegistry: "https://npm.cloudsmith.io/WORKSPACE/REPOSITORY/"
```

For a custom domain, leave the workspace out of the URL, because a custom
domain belongs to one workspace:

| `cloudsmith.io` host | Custom domain |
| --- | --- |
| `https://npm.cloudsmith.io/WORKSPACE/REPOSITORY/` | `https://HOST/REPOSITORY/` |

> [!NOTE]
> A credential in your configuration takes precedence. The plugin steps aside
> when Yarn has an `npmAuthToken` or an `npmAuthIdent` for the registry. A
> token at the top level of any `.yarnrc.yml` applies to every registry.

### Step 3: Verify the setup

1. Run `yarn plugin runtime`. The list shows `yarn-plugin-cloudsmith-auth`.
2. Run `yarn install`. Yarn installs your packages from Cloudsmith and prints
   no warning that starts with `Cloudsmith:`.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `CLOUDSMITH_CLI_PATH` | Not set | Path to the `cloudsmith` executable. When you set it, the plugin does not search `PATH`. |
| `CLOUDSMITH_YARN_TIMEOUT` | `30` | Time limit, in seconds, for each CLI command. |
| `CLOUDSMITH_YARN_TTL` | `300` | Time, in seconds, that the plugin reuses an answer from the CLI. The plugin also reuses failed answers, so a slow or broken CLI does not stall each request. |

## Use in CI

In GitHub Actions, the CLI gets a token through OIDC. Give the job the
`id-token: write` permission, and set your workspace and service account:

```yaml
permissions:
  contents: read
  id-token: write
env:
  CLOUDSMITH_ORG: WORKSPACE
  CLOUDSMITH_WORKSPACE: WORKSPACE
  CLOUDSMITH_SERVICE_SLUG: SERVICE_ACCOUNT_SLUG
```

`CLOUDSMITH_ORG` refers to your Cloudsmith workspace. The CLI uses it to get
the OIDC token. `CLOUDSMITH_WORKSPACE` makes the CLI list the custom domains of
your workspace.

## Troubleshooting

### Yarn prints a warning that starts with `Cloudsmith:`

The warning shows the error from the CLI and says how to fix it. For example,
sign in with `cloudsmith auth login`, or set `CLOUDSMITH_CLI_PATH` to the path
of the CLI.

Behind a proxy that intercepts Transport Layer Security (TLS) traffic, set
`REQUESTS_CA_BUNDLE` to a certificate authority (CA) bundle that contains the
CA of the proxy.

### Yarn gets a 401 response and prints no warning

Run these commands to find the cause:

```sh
yarn plugin runtime                                          # Is the plugin loaded?
cloudsmith domains list                                      # Is the host listed?
cloudsmith credential-helper generic > /dev/null && echo ok  # Is there a credential?
```

Then check these items:

- A package without a scope needs `npmAlwaysAuth: true`.
- An `npmAuthToken` or `npmAuthIdent` in any `.yarnrc.yml`, including
  `~/.yarnrc.yml`, takes precedence over the CLI. Remove it to use the CLI.
- For a custom domain, set `CLOUDSMITH_WORKSPACE` to the workspace that owns
  the domain.

### Known limitations

- CI does not test Windows.

## Security

- The plugin sends the credential only over HTTPS, and only to hosts that
  `cloudsmith domains list` reports as download or npm hosts.
- The plugin runs the CLI without a shell. It skips relative `PATH` entries,
  because they resolve against the project directory, which can be an
  untrusted checkout. On Windows, it accepts only `cloudsmith.exe`.
- The plugin never writes the token to disk or logs it.

To report a vulnerability, see [SECURITY.md](./SECURITY.md).

## Contributing

To build and test the project, see [CONTRIBUTING.md](./CONTRIBUTING.md). For
the release process, see [RELEASING.md](./RELEASING.md).

## License

Apache-2.0. See [LICENSE](./LICENSE).
