import { build } from "esbuild";
import packageJson from "./package.json" with { type: "json" };

await build({
  entryPoints: ["sources/index.ts"],
  outfile: `bundles/${packageJson.name}.cjs`,
  bundle: true,
  platform: "node",
  target: "node18",
  format: "iife",
  globalName: "plugin",
  external: ["@yarnpkg/*"],
  legalComments: "none",
  banner: { js: `module.exports = {name: "${packageJson.name}", factory: function (require) {` },
  footer: { js: "return plugin;\n}};" },
  plugins: [
    {
      // Yarn 4.0 gives plugins the builtin modules by their names without the `node:` prefix.
      name: "builtins-without-prefix",
      setup: (bundle) => {
        bundle.onResolve({ filter: /^node:/ }, ({ path }) => ({
          path: path.slice("node:".length),
          external: true,
        }));
      },
    },
  ],
});
