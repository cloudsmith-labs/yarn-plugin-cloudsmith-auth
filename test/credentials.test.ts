import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Output, Runner } from "../sources/cli.ts";
import { CloudsmithCredentials, seconds } from "../sources/credentials.ts";

const DOMAINS = JSON.stringify({
  version: 1,
  domains: [{ host: "npm.cloudsmith.io", format: "npm", domain_type: "native_api" }],
});
const CREDENTIAL = '{"version": 1, "username": "token", "password": "secret"}';

interface FakeCli {
  calls: string[];
  locate: () => Runner;
}

function fakeCli(answers: Record<string, string | undefined> = {}): FakeCli {
  const calls: string[] = [];
  const outputs: Record<string, string | undefined> = {
    "domains list": DOMAINS,
    "credential-helper generic": CREDENTIAL,
    ...answers,
  };
  const runner: Runner = async (args) => {
    const command = args.join(" ");
    calls.push(command);
    const stdout = outputs[command];
    return stdout === undefined ? undefined : ({ stdout, stderr: "" } satisfies Output);
  };
  return { calls, locate: () => runner };
}

function credentials(cli: FakeCli, clock = { now: 0 }, ttl = 300_000): CloudsmithCredentials {
  return new CloudsmithCredentials(
    cli.locate,
    ttl,
    () => clock.now,
    () => {},
  );
}

describe("CloudsmithCredentials", () => {
  it("returns the credential for an HTTPS registry on a listed host", async () => {
    const cli = fakeCli();
    assert.deepEqual(
      await credentials(cli).credentialFor("https://NPM.cloudsmith.io:443/acme/private"),
      { username: "token", password: "secret" },
    );
    assert.deepEqual(cli.calls, ["domains list", "credential-helper generic"]);
  });

  for (const registry of [
    "http://npm.cloudsmith.io/acme/private",
    "https://registry.npmjs.org",
    "https://npm.cloudsmith.io.example.com/acme/private",
    "not a url",
  ]) {
    it(`returns nothing and asks for no credential for ${registry}`, async () => {
      const cli = fakeCli();
      assert.equal(await credentials(cli).credentialFor(registry), undefined);
      assert.ok(!cli.calls.includes("credential-helper generic"));
    });
  }

  it("returns nothing when there is no CLI", async () => {
    const instance = new CloudsmithCredentials(
      () => undefined,
      1000,
      () => 0,
      () => {},
    );
    assert.equal(await instance.credentialFor("https://npm.cloudsmith.io/acme/private"), undefined);
  });

  it("returns nothing when the CLI has no credential", async () => {
    const cli = fakeCli({ "credential-helper generic": undefined });
    assert.equal(await credentials(cli).credentialFor("https://npm.cloudsmith.io/a/b"), undefined);
  });

  it("reuses each answer, also a failed one, until the TTL ends", async () => {
    const cli = fakeCli({ "credential-helper generic": undefined });
    const clock = { now: 0 };
    const instance = credentials(cli, clock, 1000);
    await instance.credentialFor("https://npm.cloudsmith.io/a/b");
    clock.now = 999;
    await instance.credentialFor("https://npm.cloudsmith.io/a/c");
    assert.equal(cli.calls.length, 2);
    clock.now = 1000;
    await instance.credentialFor("https://npm.cloudsmith.io/a/b");
    assert.deepEqual(cli.calls, [
      "domains list",
      "credential-helper generic",
      "domains list",
      "credential-helper generic",
    ]);
  });

  it("runs one CLI command for concurrent requests", async () => {
    const cli = fakeCli();
    const instance = credentials(cli);
    const registries = ["https://npm.cloudsmith.io/a/b", "https://npm.cloudsmith.io/a/c"];
    await Promise.all(registries.map((registry) => instance.credentialFor(registry)));
    assert.deepEqual(cli.calls, ["domains list", "credential-helper generic"]);
  });
});

describe("seconds", () => {
  it("reads a positive number of seconds as milliseconds", () => {
    assert.equal(seconds({ TIMEOUT: "2.5" }, "TIMEOUT", 7), 2500);
    assert.equal(seconds({ TIMEOUT: "0.0001" }, "TIMEOUT", 7), 1);
  });

  for (const value of [undefined, "", "0", "-1", "soon", "Infinity", "NaN"]) {
    it(`uses the default for ${String(value)}`, () => {
      const environment = value === undefined ? {} : { TIMEOUT: value };
      assert.equal(seconds(environment, "TIMEOUT", 7), 7);
    });
  }
});
