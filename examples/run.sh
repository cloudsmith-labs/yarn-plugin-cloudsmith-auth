#!/usr/bin/env bash
# Publishes the example library to Cloudsmith with Yarn, then installs it in the example app from
# Cloudsmith and runs the app. Usage: examples/run.sh
set -euo pipefail

: "${CLOUDSMITH_ORG:?Set CLOUDSMITH_ORG to your Cloudsmith workspace.}"
: "${CLOUDSMITH_REPO:?Set CLOUDSMITH_REPO to a Cloudsmith repository that you can write to.}"
# Cloudsmith rejects a version that it already has, so each run publishes a new one.
export EXAMPLE_VERSION="${EXAMPLE_VERSION:-0.1.$(date +%s)}"
registry="${CLOUDSMITH_REGISTRY_URL:-https://npm.cloudsmith.io/${CLOUDSMITH_ORG}/${CLOUDSMITH_REPO}/}"
root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT

# Cloudsmith processes an upload before it serves it, so a new version can return 404 for several
# minutes.
retry() {
  for attempt in $(seq 1 30); do
    if "$@"; then
      return 0
    fi
    echo "Attempt ${attempt} failed. Waiting 30 seconds for Cloudsmith to process the upload."
    sleep 30
  done
  return 1
}

# The version that the app installs: the version that this run published, or, with
# EXAMPLE_RESOLVE_LATEST set, the newest version that Cloudsmith has processed. Some workspaces take
# much longer than others to process an upload.
resolve_version() {
  local latest=""
  if [ -n "${EXAMPLE_RESOLVE_LATEST:-}" ]; then
    latest="$(cloudsmith ls pkgs "${CLOUDSMITH_ORG}/${CLOUDSMITH_REPO}" -F json -l 1 --sort=-date \
      -q "name:^cloudsmith-example-yarn$ AND status:completed" | jq -r '.data[0].version // empty')"
  fi
  echo "${latest:-${EXAMPLE_VERSION}}"
}

# Copies an example to the work directory, sends every request to Cloudsmith, and imports the
# plugin as a user does. The configuration has no credential. npmAlwaysAuth makes Yarn ask the
# plugin for a credential for packages without a scope.
prepare() {
  cp -R "${root}/examples/$1" "${work}/$1"
  touch "${work}/$1/yarn.lock"
  cat > "${work}/$1/.yarnrc.yml" <<YAML
enableGlobalCache: false
# Yarn makes installs immutable in CI. Each run makes a new lockfile.
enableImmutableInstalls: false
enableTelemetry: false
npmAlwaysAuth: true
npmPreapprovedPackages: ["cloudsmith-example-yarn"]
npmRegistryServer: "${registry}"
YAML
  (cd "${work}/$1" && yarn plugin import "${root}/bundles/yarn-plugin-cloudsmith-auth.cjs")
}

install_and_run() {
  rm -rf .yarn/cache .pnp.cjs
  yarn install && yarn node index.js
}

prepare library
(cd "${work}/library" && sed -i.bak "s/\"0\.1\.0\"/\"${EXAMPLE_VERSION}\"/" package.json && rm package.json.bak \
  && yarn install && yarn npm publish)

prepare app
version="$(resolve_version)"
(cd "${work}/app" && sed -i.bak "s/\"0\.1\.0\"/\"${version}\"/" package.json && rm package.json.bak \
  && retry install_and_run)
echo "Published cloudsmith-example-yarn ${EXAMPLE_VERSION}, and installed cloudsmith-example-yarn ${version} from Cloudsmith"
