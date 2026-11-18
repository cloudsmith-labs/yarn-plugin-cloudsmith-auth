import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import { join } from "node:path";

export const HOST = "127.0.0.1";

/** A publish time old enough for the minimal age gate of Yarn. */
const PUBLISHED = "2000-01-01T00:00:00.000Z";

export interface Request {
  method: string;
  path: string;
  authorization: string | undefined;
}

interface Packument {
  name: string;
  "dist-tags": Record<string, string>;
  versions: Record<string, { dist: { tarball: string } }>;
  time: Record<string, string>;
}

interface PublishBody {
  name: string;
  "dist-tags": Record<string, string>;
  versions: Record<string, { dist: { tarball: string } }>;
  _attachments: Record<string, { data: string }>;
}

/**
 * An npm registry on a local HTTPS server that demands authentication.
 *
 * A request without an `Authorization` header gets 401, like a private Cloudsmith repository. The
 * server accepts any credential and records it, so a test asserts which credential Yarn sent. It
 * stores each package that Yarn publishes, and serves it to installs.
 */
export class Registry {
  readonly requests: Request[] = [];
  readonly certificate: string;
  private readonly packuments = new Map<string, Packument>();
  private readonly tarballs = new Map<string, Buffer>();
  private readonly server: Server;

  private constructor(directory: string) {
    const key = join(directory, "registry-key.pem");
    this.certificate = join(directory, "registry-cert.pem");
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-days",
        "1",
        "-keyout",
        key,
        "-out",
        this.certificate,
        "-subj",
        `/CN=${HOST}`,
        "-addext",
        `subjectAltName=IP:${HOST}`,
      ],
      { stdio: "ignore" },
    );
    this.server = createServer(
      { key: readFileSync(key), cert: readFileSync(this.certificate) },
      (request, response) => void this.serve(request, response),
    );
  }

  static async start(directory: string): Promise<Registry> {
    const registry = new Registry(directory);
    await new Promise<void>((resolve) => registry.server.listen(0, HOST, resolve));
    return registry;
  }

  get url(): string {
    return `https://${HOST}:${(this.server.address() as AddressInfo).port}`;
  }

  close(): Promise<void> {
    this.server.closeAllConnections();
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  private async serve(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const path = decodeURIComponent(new URL(request.url ?? "/", this.url).pathname);
    const method = request.method ?? "GET";
    const authorization = request.headers.authorization;
    this.requests.push({ method, path, authorization });
    const body = await readBody(request);
    if (authorization === undefined) {
      response.writeHead(401, { "www-authenticate": 'Basic realm="Cloudsmith"' }).end();
    } else if (method === "PUT") {
      this.publish(JSON.parse(body.toString("utf8")) as PublishBody);
      response.writeHead(201, { "content-type": "application/json" }).end('{"ok": true}');
    } else {
      this.download(path, response);
    }
  }

  private publish(body: PublishBody): void {
    const packument = this.packuments.get(body.name) ?? {
      name: body.name,
      "dist-tags": {},
      versions: {},
      time: {},
    };
    for (const [file, attachment] of Object.entries(body._attachments)) {
      const path = `/${body.name}/-/${file.split("/").pop()}`;
      this.tarballs.set(path, Buffer.from(attachment.data, "base64"));
      for (const [version, manifest] of Object.entries(body.versions)) {
        manifest.dist.tarball = this.url + path;
        packument.versions[version] = manifest;
        packument.time[version] = PUBLISHED;
      }
    }
    Object.assign(packument["dist-tags"], body["dist-tags"]);
    this.packuments.set(body.name, packument);
  }

  private download(path: string, response: ServerResponse): void {
    const tarball = this.tarballs.get(path);
    const packument = this.packuments.get(path.slice(1));
    if (tarball) {
      response.writeHead(200, { "content-type": "application/octet-stream" }).end(tarball);
    } else if (packument) {
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify(packument));
    } else {
      response.writeHead(404).end();
    }
  }
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}
