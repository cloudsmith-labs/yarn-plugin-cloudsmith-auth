import {
  type Credential,
  credential,
  findBinary,
  missingBinaryMessage,
  npmHosts,
  type Runner,
  run,
  type Warn,
} from "./cli.ts";

type Environment = Readonly<Record<string, string | undefined>>;

/**
 * Decides, through the CLI, which registry URLs get the CLI credential.
 *
 * Both answers of the CLI are cached for a short TTL. The credential contract carries no expiry,
 * and the token can be a short-lived OIDC or SAML token or an API key that the user can revoke at
 * any time.
 */
export class CloudsmithCredentials {
  private readonly locate: () => Runner | undefined;
  private readonly hosts: Cached<Set<string> | undefined>;
  private readonly credential: Cached<Credential | undefined>;
  private readonly warn: Warn;

  constructor(locate: () => Runner | undefined, ttlMs: number, now: () => number, warn: Warn) {
    this.locate = locate;
    this.hosts = new Cached(ttlMs, now);
    this.credential = new Cached(ttlMs, now);
    this.warn = warn;
  }

  /** Returns the CLI credential for an HTTPS URL on a host that the CLI lists, else nothing. */
  async credentialFor(url: string): Promise<Credential | undefined> {
    const host = httpsHost(url);
    if (host === undefined) {
      return undefined;
    }
    const hosts = await this.hosts.get(() => this.withCli((cli) => npmHosts(cli, this.warn)));
    if (!hosts?.has(host)) {
      return undefined;
    }
    return this.credential.get(() => this.withCli((cli) => credential(cli, this.warn)));
  }

  private async withCli<T>(command: (cli: Runner) => Promise<T>): Promise<T | undefined> {
    const cli = this.locate();
    return cli && command(cli);
  }
}

export function fromEnvironment(environment: Environment, warn: Warn): CloudsmithCredentials {
  const timeout = seconds(environment, "CLOUDSMITH_YARN_TIMEOUT", 30_000);
  const ttl = seconds(environment, "CLOUDSMITH_YARN_TTL", 300_000);
  const windows = process.platform === "win32";
  const locate = (): Runner | undefined => {
    const binary = findBinary(environment, windows);
    if (binary === undefined) {
      warn(missingBinaryMessage(environment));
      return undefined;
    }
    return (args) => run(binary, args, timeout, warn);
  };
  return new CloudsmithCredentials(locate, ttl, () => performance.now(), warn);
}

/**
 * Returns the variable, a number of seconds, in milliseconds, or the default if it is not a
 * positive, finite number. A zero timeout or TTL is never what the user meant, and a silent
 * fallback is safer than an install that fails far from the cause.
 */
export function seconds(environment: Environment, name: string, defaultMs: number): number {
  const value = Number(environment[name] || Number.NaN);
  return value > 0 && Number.isFinite(value) ? Math.ceil(value * 1000) : defaultMs;
}

function httpsHost(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.hostname.toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Keeps the result of one load, including an empty result, for the TTL.
 *
 * A failed load is kept too. Yarn asks again for each request, so a CLI that hangs until its
 * timeout would otherwise stall each of them. Concurrent requests share the pending load, so they
 * start one CLI process, not one each.
 */
class Cached<T> {
  private readonly ttlMs: number;
  private readonly now: () => number;
  private loadedAt = 0;
  private value: Promise<T> | undefined;

  constructor(ttlMs: number, now: () => number) {
    this.ttlMs = ttlMs;
    this.now = now;
  }

  get(load: () => Promise<T>): Promise<T> {
    const now = this.now();
    if (this.value === undefined || now - this.loadedAt >= this.ttlMs) {
      this.value = load();
      this.loadedAt = now;
    }
    return this.value;
  }
}
