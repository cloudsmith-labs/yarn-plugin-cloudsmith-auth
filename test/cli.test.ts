import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { credential, findBinary, npmHosts, type Output, run } from "../sources/cli.ts";

const FIXTURE = readFileSync(new URL("fixtures/domains_list_v1.json", import.meta.url), "utf8");

function answering(stdout: string, stderr = ""): () => Promise<Output> {
  return async () => ({ stdout, stderr });
}

function collector(): { warnings: string[]; warn: (message: string) => void } {
  const warnings: string[] = [];
  return { warnings, warn: (message) => warnings.push(message) };
}

function script(body: string, name = "cloudsmith"): string {
  const directory = mkdtempSync(join(tmpdir(), "cloudsmith-cli-"));
  const path = join(directory, name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o700);
  return path;
}

describe("npmHosts", () => {
  it("returns the download hosts and the npm hosts of a real answer", async () => {
    const { warn } = collector();
    assert.deepEqual(
      await npmHosts(answering(FIXTURE), warn),
      new Set(["dl.cloudsmith.io", "npm.cloudsmith.io"]),
    );
  });

  it("returns custom npm domains in lower case", async () => {
    const answer = JSON.stringify({
      version: 1,
      domains: [
        { host: "NPM.Example.COM", format: "npm", domain_type: "native_api" },
        { host: "maven.example.com", format: "maven", domain_type: "native_api" },
        { host: "upload.example.com", format: null, domain_type: "upload" },
      ],
    });
    assert.deepEqual(
      await npmHosts(answering(answer), collector().warn),
      new Set(["npm.example.com"]),
    );
  });

  it("returns no hosts for an unsupported contract version", async () => {
    const answer = JSON.stringify({ version: 2, domains: [{ host: "dl.cloudsmith.io" }] });
    assert.deepEqual(await npmHosts(answering(answer), collector().warn), new Set());
  });

  it("returns nothing when the domains are not a list", async () => {
    assert.equal(await npmHosts(answering('{"version": 1}'), collector().warn), undefined);
  });

  it("returns nothing and warns when the answer is not JSON", async () => {
    const { warnings, warn } = collector();
    const answer = answering("Notice: update\n", "Notice: a new version\nError: bad");
    assert.equal(await npmHosts(answer, warn), undefined);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0] ?? "", /not JSON.*Update the cloudsmith CLI/s);
    assert.match(warnings[0] ?? "", /`cloudsmith domains list` printed:\nError: bad$/);
  });

  it("returns nothing when the CLI fails", async () => {
    assert.equal(await npmHosts(async () => undefined, collector().warn), undefined);
  });
});

describe("credential", () => {
  it("returns the username and the password", async () => {
    const answer = '{"version": 1, "username": "token", "password": "secret"}';
    assert.deepEqual(await credential(answering(answer), collector().warn), {
      username: "token",
      password: "secret",
    });
  });

  for (const answer of [
    '{"version": 2, "username": "token", "password": "secret"}',
    '{"version": 1, "username": "token", "password": ""}',
    '{"version": 1, "username": "token"}',
    '["token", "secret"]',
  ]) {
    it(`returns nothing for ${answer}`, async () => {
      assert.equal(await credential(answering(answer), collector().warn), undefined);
    });
  }
});

describe("findBinary", () => {
  it("uses CLOUDSMITH_CLI_PATH and does not search PATH", () => {
    const binary = script("exit 0");
    const other = script("exit 0");
    const environment = { CLOUDSMITH_CLI_PATH: binary, PATH: join(other, "..") };
    assert.equal(findBinary(environment, false), binary);
  });

  it("returns nothing when CLOUDSMITH_CLI_PATH is not an executable file", () => {
    const directory = mkdtempSync(join(tmpdir(), "cloudsmith-cli-"));
    const notExecutable = join(directory, "cloudsmith");
    writeFileSync(notExecutable, "");
    for (const path of [notExecutable, directory, join(directory, "missing")]) {
      assert.equal(findBinary({ CLOUDSMITH_CLI_PATH: path }, false), undefined);
    }
  });

  it("returns the first executable on PATH and skips relative entries", () => {
    const first = script("exit 0");
    const second = script("exit 0");
    const directory = join(first, "..");
    const path = ["relative", join(mkdtempSync(join(tmpdir(), "empty-")), "."), directory];
    assert.equal(findBinary({ PATH: [...path, join(second, "..")].join(":") }, false), first);
    process.chdir(directory);
    assert.equal(findBinary({ PATH: "." }, false), undefined);
  });

  it("accepts only cloudsmith.exe on Windows", () => {
    const directory = join(script("exit 0", "cloudsmith.cmd"), "..");
    assert.equal(findBinary({ PATH: directory }, true), undefined);
    const exe = script("exit 0", "cloudsmith.exe");
    assert.equal(findBinary({ PATH: join(exe, "..") }, true), exe);
  });
});

describe("run", () => {
  it("returns the output of a command that succeeds, with an empty stdin", async () => {
    const binary = script('cat; printf "%s" "$*"; echo note >&2');
    assert.deepEqual(await run(binary, ["domains", "list"], 10_000, collector().warn), {
      stdout: "domains list",
      stderr: "note",
    });
  });

  it("warns how to sign in when the CLI has no credential", async () => {
    const binary = script(
      "echo 'Notice: update available' >&2; echo 'Error: Unable to retrieve credentials.' >&2; exit 1",
    );
    const { warnings, warn } = collector();
    assert.equal(await run(binary, ["credential-helper", "generic"], 10_000, warn), undefined);
    assert.deepEqual(warnings, [
      "Cloudsmith: the cloudsmith CLI is not signed in, or its credential is not valid, so Yarn " +
        "gets no credential for Cloudsmith registries. Sign in with `cloudsmith auth`, or set " +
        "CLOUDSMITH_API_KEY. `cloudsmith whoami --verbose` shows the credential that the CLI " +
        "uses. `cloudsmith credential-helper generic` exited with status 1 and printed:\n" +
        "Error: Unable to retrieve credentials.",
    ]);
  });

  it("warns with the status of a command that fails silently", async () => {
    const { warnings, warn } = collector();
    assert.equal(await run(script("exit 3"), ["domains", "list"], 10_000, warn), undefined);
    assert.deepEqual(warnings, [
      "Cloudsmith: the cloudsmith CLI failed, so Yarn gets no credential for Cloudsmith " +
        "registries. `cloudsmith domains list` exited with status 3.",
    ]);
  });

  it("stops a command that does not answer in time", async () => {
    const { warnings, warn } = collector();
    const binary = script("echo 'Error: still waiting' >&2; exec sleep 30");
    const started = Date.now();
    assert.equal(await run(binary, ["domains", "list"], 500, warn), undefined);
    assert.ok(Date.now() - started < 5_000);
    assert.equal(warnings.length, 1);
    assert.match(
      warnings[0] ?? "",
      /did not answer in 0\.5 seconds.*CLOUDSMITH_YARN_TIMEOUT.*printed so far:\nError: still waiting$/s,
    );
  });

  it("warns when the CLI cannot start", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cloudsmith-cli-"));
    mkdirSync(join(directory, "cloudsmith"));
    const { warnings, warn } = collector();
    assert.equal(
      await run(join(directory, "cloudsmith"), ["domains", "list"], 10_000, warn),
      undefined,
    );
    assert.match(warnings[0] ?? "", /could not run.*`cloudsmith domains list` failed: /s);
  });
});
