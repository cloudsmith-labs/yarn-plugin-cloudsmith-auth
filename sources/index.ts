import { type Configuration, MessageName, type Plugin, StreamReport } from "@yarnpkg/core";
import { type Hooks, npmConfigUtils } from "@yarnpkg/plugin-npm";
import { type CloudsmithCredentials, fromEnvironment } from "./credentials.ts";

let credentials: CloudsmithCredentials | undefined;

/**
 * Returns Basic auth with the CLI credential for a Cloudsmith registry.
 *
 * Yarn calls this hook before it reads `npmAuthToken` and `npmAuthIdent`, so the hook steps aside
 * when the configuration has either of them. A credential in the configuration then takes
 * precedence over the CLI, as it does for the other Cloudsmith build tool plugins.
 */
async function getNpmAuthenticationHeader(
  currentHeader: string | undefined,
  registry: string,
  options: Parameters<NonNullable<Hooks["getNpmAuthenticationHeader"]>>[2],
): Promise<string | undefined> {
  const authConfiguration = npmConfigUtils.getAuthConfiguration(registry, options);
  if (
    currentHeader ||
    authConfiguration.get("npmAuthToken") ||
    authConfiguration.get("npmAuthIdent")
  ) {
    return currentHeader;
  }
  credentials ??= fromEnvironment(process.env, (message) => warn(options.configuration, message));
  const credential = await credentials.credentialFor(registry);
  if (credential === undefined) {
    return currentHeader;
  }
  const pair = `${credential.username}:${credential.password}`;
  return `Basic ${Buffer.from(pair).toString("base64")}`;
}

function warn(configuration: Configuration, message: string): void {
  new StreamReport({ configuration, stdout: process.stdout }).reportWarning(
    MessageName.UNNAMED,
    message,
  );
}

const plugin: Plugin<Hooks> = { hooks: { getNpmAuthenticationHeader } };

export default plugin;
