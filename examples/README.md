# Examples

These examples publish a small library to a real Cloudsmith repository with
Yarn, and then install it in an app and run the app:

| Directory | Contents |
|-----------|----------|
| `library/` | The package `cloudsmith-example-yarn`, which `yarn npm publish` publishes |
| `app/` | An app that installs `cloudsmith-example-yarn` from Cloudsmith, the only registry |

Neither project has a credential in `.yarnrc.yml` or in an environment
variable that Yarn reads. Each project imports the plugin from this checkout
with `yarn plugin import`.

## Prerequisites

- [mise](https://mise.jdx.dev/), which installs everything else.
- A Cloudsmith repository that you can write to.
- The Cloudsmith CLI authenticated with `cloudsmith auth login` or
  `CLOUDSMITH_API_KEY`.

## Run the examples

1. Set the repository to use:

   ```sh
   export CLOUDSMITH_ORG=WORKSPACE
   export CLOUDSMITH_REPO=REPOSITORY
   ```

2. For a custom domain, also set its URL:

   ```sh
   export CLOUDSMITH_REGISTRY_URL="https://HOST/REPOSITORY/"
   ```

3. Run the examples from the root of the repository:

   ```sh
   mise run example
   ```

Each run publishes a new version, because Cloudsmith does not accept the same
version twice. Set `EXAMPLE_VERSION` to choose the version.

Cloudsmith processes an upload before it serves it, so a new version can return
404 for several minutes. Each run retries the app install for up to 15 minutes.
