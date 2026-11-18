import { type ExecFileException, execFile } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";

/** The stdout and stderr of a CLI command that exited with status 0. */
export interface Output {
  stdout: string;
  stderr: string;
}

/** Takes the CLI arguments and returns the output of the CLI, or nothing if it failed. */
export type Runner = (args: readonly string[]) => Promise<Output | undefined>;

export type Warn = (message: string) => void;

/** A Basic auth username and password from `cloudsmith credential-helper generic`. */
export interface Credential {
  username: string;
  password: string;
}

const CONTRACT_VERSION = 1;
const NO_CREDENTIAL = "so Yarn gets no credential for Cloudsmith registries";
const SIGN_IN =
  " Sign in with `cloudsmith auth`, or set CLOUDSMITH_API_KEY. `cloudsmith whoami --verbose`" +
  " shows the credential that the CLI uses.";
/** The text of the CLI when it has no credential, or the API rejects it. */
const NO_VALID_CREDENTIAL = /\b401\b|Unable to retrieve credentials/;
const FIRST_ERROR = /^Error:/m;
const OUTPUT_LIMIT = 1024 * 1024;

/**
 * Returns CLOUDSMITH_CLI_PATH if it is set, else the first `cloudsmith` on PATH, else nothing.
 *
 * Relative PATH entries are skipped. They resolve against the directory that Yarn runs in, which
 * is often an untrusted checkout. A binary planted there would answer `domains list` too, so it
 * could declare any host to be Cloudsmith and then collect the credential for it. On Windows only
 * `cloudsmith.exe` is accepted, because a `.bat` or `.cmd` file is the easiest file to plant.
 */
export function findBinary(
  environment: Readonly<Record<string, string | undefined>>,
  windows: boolean,
): string | undefined {
  const explicitPath = environment.CLOUDSMITH_CLI_PATH;
  if (explicitPath) {
    return isExecutableFile(explicitPath) ? explicitPath : undefined;
  }
  const name = windows ? "cloudsmith.exe" : "cloudsmith";
  return (environment.PATH ?? "")
    .split(windows ? ";" : delimiter)
    .filter((directory) => isAbsolute(directory))
    .map((directory) => join(directory, name))
    .find(isExecutableFile);
}

export function missingBinaryMessage(
  environment: Readonly<Record<string, string | undefined>>,
): string {
  const explicitPath = environment.CLOUDSMITH_CLI_PATH;
  if (explicitPath) {
    return (
      `Cloudsmith: CLOUDSMITH_CLI_PATH is ${explicitPath}, which is not an executable file, ` +
      `${NO_CREDENTIAL}. Set CLOUDSMITH_CLI_PATH to the path of the cloudsmith CLI.`
    );
  }
  return (
    `Cloudsmith: the cloudsmith CLI is not on PATH, ${NO_CREDENTIAL}. Install the cloudsmith ` +
    "CLI, or set CLOUDSMITH_CLI_PATH to its path."
  );
}

/**
 * Runs the binary directly, with no shell and an empty stdin, and returns its output.
 *
 * A failure warns with the stderr of the CLI, which explains most failures. The CLI never prints
 * the credential on stderr.
 */
export function run(
  binary: string,
  args: readonly string[],
  timeoutMs: number,
  warn: Warn,
): Promise<Output | undefined> {
  const commandLine = `cloudsmith ${args.join(" ")}`;
  return new Promise((resolve) => {
    const child = execFile(
      binary,
      args,
      {
        encoding: "utf8",
        killSignal: "SIGKILL",
        maxBuffer: OUTPUT_LIMIT,
        timeout: timeoutMs,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          warn(failureMessage(commandLine, error, stderr.trim(), timeoutMs));
          resolve(undefined);
        } else {
          resolve({ stdout, stderr: stderr.trim() });
        }
      },
    );
    child.stdin?.end();
  });
}

function failureMessage(
  commandLine: string,
  error: ExecFileException,
  stderr: string,
  timeoutMs: number,
): string {
  if (typeof error.code === "string") {
    return (
      `Cloudsmith: the cloudsmith CLI could not run, ${NO_CREDENTIAL}. ` +
      `\`${commandLine}\` failed: ${error.message}`
    );
  }
  if (error.killed) {
    return (
      `Cloudsmith: the cloudsmith CLI did not answer in ${timeoutMs / 1000} seconds, ` +
      `${NO_CREDENTIAL}. Set CLOUDSMITH_YARN_TIMEOUT to a larger number of seconds.` +
      printed(`\`${commandLine}\` printed so far:`, stderr)
    );
  }
  const cause = NO_VALID_CREDENTIAL.test(stderr)
    ? `the cloudsmith CLI is not signed in, or its credential is not valid, ${NO_CREDENTIAL}.${SIGN_IN}`
    : `the cloudsmith CLI failed, ${NO_CREDENTIAL}.`;
  const exited = `\`${commandLine}\` exited with status ${error.code ?? error.signal}`;
  return `Cloudsmith: ${cause}${stderr ? printed(`${exited} and printed:`, stderr) : ` ${exited}.`}`;
}

/**
 * Returns the introduction and then the stderr of the CLI from its first `Error:` line, so that
 * unrelated notices of the CLI drop out. Returns an empty string for an empty stderr.
 */
function printed(introduction: string, stderr: string): string {
  if (!stderr) {
    return "";
  }
  const error = FIRST_ERROR.exec(stderr);
  return ` ${introduction}\n${error ? stderr.slice(error.index) : stderr}`;
}

/** Runs `credential-helper generic` and returns its credential, or nothing. */
export async function credential(runner: Runner, warn: Warn): Promise<Credential | undefined> {
  const payload = await runForObject(runner, ["credential-helper", "generic"], warn);
  if (payload?.version !== CONTRACT_VERSION) {
    return undefined;
  }
  const { username, password } = payload;
  return isNonEmptyString(username) && isNonEmptyString(password)
    ? { username, password }
    : undefined;
}

/**
 * Runs `domains list` and returns the hosts that serve npm, or nothing on failure.
 *
 * A host serves npm if it is a download host, which serves every format, or the npm native API
 * host. The CLI lists only enabled, validated domains, and adds the custom domains of the
 * workspace when it knows the workspace. An unsupported contract version is an answer with no
 * hosts, so an unknown response shape is never guessed at.
 */
export async function npmHosts(runner: Runner, warn: Warn): Promise<Set<string> | undefined> {
  const payload = await runForObject(runner, ["domains", "list"], warn);
  if (payload === undefined) {
    return undefined;
  }
  if (payload.version !== CONTRACT_VERSION) {
    return new Set();
  }
  const domains = payload.domains;
  if (!Array.isArray(domains)) {
    return undefined;
  }
  const hosts = domains
    .filter(isObject)
    .filter(servesNpm)
    .map((domain) => domain.host)
    .filter(isNonEmptyString)
    .map((host) => host.toLowerCase());
  return new Set(hosts);
}

async function runForObject(
  runner: Runner,
  args: readonly string[],
  warn: Warn,
): Promise<Record<string, unknown> | undefined> {
  const output = await runner(args);
  if (output === undefined) {
    return undefined;
  }
  try {
    const value: unknown = JSON.parse(output.stdout);
    return isObject(value) ? value : undefined;
  } catch {
    warn(
      `Cloudsmith: the cloudsmith CLI gave an answer that is not JSON, ${NO_CREDENTIAL}. ` +
        "Update the cloudsmith CLI." +
        printed(`\`cloudsmith ${args.join(" ")}\` printed:`, output.stderr),
    );
    return undefined;
  }
}

function servesNpm(domain: Record<string, unknown>): boolean {
  const domainType = domain.domain_type;
  return domainType === "download" || (domainType === "native_api" && domain.format === "npm");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

function isExecutableFile(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
