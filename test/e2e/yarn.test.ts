import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  accessSync,
  chmodSync,
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { HOST, Registry } from "./registry.ts";

const BUNDLE = fileURLToPath(
  new URL("../../bundles/yarn-plugin-cloudsmith-auth.cjs", import.meta.url),
);
const PASSWORD = "e2e-secret";
const CLI_CREDENTIAL = `Basic ${Buffer.from(`token:${PASSWORD}`).toString("base64")}`;
/** The Yarn under test: IT_YARN_HOME, or the Yarn on PATH. */
const YARN = process.env.IT_YARN_HOME
  ? join(process.env.IT_YARN_HOME, "bin", "yarn")
  : findOnPath("yarn");
/** The Node that runs the Yarn under test: IT_NODE_HOME, or the Node that runs the tests. */
const NODE_BIN = process.env.IT_NODE_HOME
  ? join(process.env.IT_NODE_HOME, "bin")
  : dirname(process.execPath);

type CliMode = "answers" | "signed-out" | "lists-other-host";

interface World {
  directory: string;
  home: string;
  env: Record<string, string>;
  cliCalls: () => string[];
}

interface Result {
  status: number;
  output: string;
}

let registry: Registry;
let root: string;

function findOnPath(name: string): string {
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    try {
      accessSync(join(directory, name), constants.X_OK);
      return join(directory, name);
    } catch {}
  }
  throw new Error(`${name} is not on PATH`);
}

/** Writes a shell script that answers the two `cloudsmith` commands like the real CLI. */
function writeCli(directory: string, mode: CliMode): void {
  const host = mode === "lists-other-host" ? "npm.cloudsmith.io" : HOST;
  const domains = JSON.stringify({
    version: 1,
    domains: [{ host, format: "npm", type: "custom", domain_type: "native_api" }],
  });
  const answers =
    mode === "signed-out"
      ? `echo "Error: Failed to fetch domains for 'acme': 401 - Authentication credentials were not provided." >&2; exit 1`
      : `case "$1 $2" in
  "domains list") printf '%s\\n' '${domains}' ;;
  "credential-helper generic") printf '%s\\n' '{"version": 1, "username": "token", "password": "${PASSWORD}"}' ;;
  *) exit 1 ;;
esac`;
  const script = join(directory, "cloudsmith");
  writeFileSync(script, `#!/bin/sh\necho "$*" >> "$(dirname "$0")/calls.log"\n${answers}\n`);
  chmodSync(script, 0o700);
}

/** Returns a home, and a PATH with Node, Yarn, and the shell tools, but no real cloudsmith CLI. */
function world(cli: CliMode | "missing" = "answers"): World {
  const directory = mkdtempSync(join(root, "world-"));
  const home = join(directory, "home");
  const cliDirectory = join(directory, "cli");
  mkdirSync(home);
  mkdirSync(cliDirectory);
  if (cli !== "missing") {
    writeCli(cliDirectory, cli);
  }
  const path = [cliDirectory, NODE_BIN, dirname(YARN), "/usr/bin", "/bin"];
  return {
    directory,
    home,
    env: {
      HOME: home,
      PATH: path.join(delimiter),
      NODE_EXTRA_CA_CERTS: registry.certificate,
    },
    cliCalls: () => {
      const log = join(cliDirectory, "calls.log");
      return existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : [];
    },
  };
}

function yarn(cwd: string, args: string[], env: Record<string, string>): Promise<Result> {
  return new Promise((resolve) => {
    execFile(YARN, args, { cwd, env }, (error, stdout, stderr) => {
      resolve({
        status: typeof error?.code === "number" ? error.code : 0,
        output: stdout + stderr,
      });
    });
  });
}

/** Creates a Yarn project with the plugin, which `yarn plugin import` installs like a user does. */
async function project(
  at: World,
  name: string,
  manifest: Record<string, unknown>,
  rc: string,
  importPlugin = true,
): Promise<string> {
  const directory = join(at.directory, name);
  mkdirSync(directory);
  writeFileSync(join(directory, "package.json"), JSON.stringify(manifest));
  writeFileSync(join(directory, "yarn.lock"), "");
  writeFileSync(
    join(directory, ".yarnrc.yml"),
    `enableTelemetry: false\nnodeLinker: node-modules\n` +
      `npmScopes:\n  acme:\n    npmRegistryServer: "${registry.url}"\n${rc}`,
  );
  if (importPlugin) {
    const imported = await yarn(directory, ["plugin", "import", BUNDLE], at.env);
    assert.equal(imported.status, 0, imported.output);
  }
  return directory;
}

async function publish(name: string): Promise<void> {
  const at = world();
  const library = await project(
    at,
    "library",
    { name, version: "1.0.0", main: "index.js" },
    `npmPublishRegistry: "${registry.url}"\n`,
  );
  writeFileSync(join(library, "index.js"), `module.exports = ${JSON.stringify(name)};\n`);
  for (const args of [["install"], ["npm", "publish"]]) {
    const result = await yarn(library, args, at.env);
    assert.equal(result.status, 0, result.output);
  }
}

async function app(
  at: World,
  dependencies: Record<string, string>,
  rc = "",
  importPlugin = true,
): Promise<{ directory: string; result: Result }> {
  const directory = await project(at, "app", { name: "app", dependencies }, rc, importPlugin);
  registry.requests.length = 0;
  return { directory, result: await yarn(directory, ["install"], at.env) };
}

function installed(directory: string, name: string): boolean {
  return existsSync(join(directory, "node_modules", name, "package.json"));
}

function authorizations(): (string | undefined)[] {
  return [...new Set(registry.requests.map((request) => request.authorization))];
}

describe(`${YARN} on the Node in ${NODE_BIN}`, () => {
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "yarn-plugin-cloudsmith-auth-"));
    registry = await Registry.start(root);
    for (const name of ["@acme/greeting", "@acme/farewell", "greeting"]) {
      await publish(name);
    }
  });

  after(() => registry.close());

  it("publishes with the CLI credential", () => {
    registry.requests.length = 0;
    return publish("@acme/published").then(() => {
      const puts = registry.requests.filter((request) => request.method === "PUT");
      assert.equal(puts.length, 1);
      assert.equal(puts[0]?.authorization, CLI_CREDENTIAL);
    });
  });

  it("installs scoped packages with the CLI credential, and runs the CLI once", async () => {
    const at = world();
    const { directory, result } = await app(at, {
      "@acme/greeting": "1.0.0",
      "@acme/farewell": "1.0.0",
    });
    assert.equal(result.status, 0, result.output);
    assert.ok(installed(directory, "@acme/greeting"));
    assert.ok(installed(directory, "@acme/farewell"));
    assert.ok(registry.requests.some((request) => request.path.endsWith(".tgz")));
    assert.deepEqual(authorizations(), [CLI_CREDENTIAL]);
    assert.deepEqual(at.cliCalls(), ["domains list", "credential-helper generic"]);
  });

  it("installs unscoped packages from a registry with npmAlwaysAuth", async () => {
    const rc = `npmRegistryServer: "${registry.url}"\nnpmAlwaysAuth: true\n`;
    const { directory, result } = await app(world(), { greeting: "1.0.0" }, rc);
    assert.equal(result.status, 0, result.output);
    assert.ok(installed(directory, "greeting"));
    assert.deepEqual(authorizations(), [CLI_CREDENTIAL]);
  });

  it("works from the plugins of the user configuration in the home directory", async () => {
    const at = world();
    mkdirSync(join(at.home, ".yarn", "plugins"), { recursive: true });
    copyFileSync(BUNDLE, join(at.home, ".yarn", "plugins", "yarn-plugin-cloudsmith-auth.cjs"));
    writeFileSync(
      join(at.home, ".yarnrc.yml"),
      "plugins:\n  - path: .yarn/plugins/yarn-plugin-cloudsmith-auth.cjs\n",
    );
    const { directory, result } = await app(at, { "@acme/greeting": "1.0.0" }, "", false);
    assert.equal(result.status, 0, result.output);
    assert.ok(installed(directory, "@acme/greeting"));
    assert.deepEqual(authorizations(), [CLI_CREDENTIAL]);
  });

  it("lets a token in the configuration take precedence", async () => {
    const at = world();
    const rc = `    npmAuthToken: "configured"\n`;
    const { result } = await app(at, { "@acme/greeting": "1.0.0" }, rc);
    assert.equal(result.status, 0, result.output);
    assert.deepEqual(authorizations(), ["Bearer configured"]);
    assert.deepEqual(at.cliCalls(), []);
  });

  it("sends no credential to a host that the CLI does not list", async () => {
    const at = world("lists-other-host");
    const { result } = await app(at, { "@acme/greeting": "1.0.0" });
    assert.notEqual(result.status, 0, result.output);
    assert.deepEqual(authorizations(), [undefined]);
    assert.deepEqual(at.cliCalls(), ["domains list"]);
  });

  it("warns when the cloudsmith CLI is missing", async () => {
    const { result } = await app(world("missing"), { "@acme/greeting": "1.0.0" });
    assert.notEqual(result.status, 0, result.output);
    assert.match(result.output, /YN0000: Cloudsmith: the cloudsmith CLI is not on PATH/);
    assert.deepEqual(authorizations(), [undefined]);
  });

  it("warns how to sign in when the cloudsmith CLI is signed out", async () => {
    const { result } = await app(world("signed-out"), { "@acme/greeting": "1.0.0" });
    assert.notEqual(result.status, 0, result.output);
    assert.match(result.output, /Cloudsmith: the cloudsmith CLI is not signed in/);
    assert.match(result.output, /printed:\nError: Failed to fetch domains for 'acme': 401/);
    assert.deepEqual(authorizations(), [undefined]);
  });
});
