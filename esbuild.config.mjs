// Bundles src/ into one IIFE that bootstrap.js injects into each note-editor
// iframe. No runtime dependencies: the bundle talks to the ProseMirror
// instance that Zotero already has running in that window.
import esbuild from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";

// `import x from "./file.js?raw"` gives the file's source text. The default
// snippets are shipped as editable JavaScript (regex literals, functions) and
// have to reach the settings pane as source, not as a parsed value.
const rawImports = {
	name: "raw-imports",
	setup(build) {
		build.onResolve({ filter: /\?raw$/ }, (args) => ({
			path: path.resolve(args.resolveDir, args.path.replace(/\?raw$/, "")),
			namespace: "raw",
		}));
		build.onLoad({ filter: /.*/, namespace: "raw" }, async (args) => ({
			contents: await fs.readFile(args.path, "utf8"),
			loader: "text",
		}));
	},
};

const opts = {
	entryPoints: ["src/main.ts"],
	bundle: true,
	format: "iife",
	target: "firefox115", // Zotero 7 / 8 are on the 115 ESR platform
	outfile: "build/content-script.js",
	logLevel: "info",
	legalComments: "none",
	plugins: [rawImports],
};

// The renderer on its own, for the item pane: that runs in chrome, where the
// content bundle cannot be injected, and duplicating the logic would let the
// two drift apart.
const renderOpts = {
	...opts,
	entryPoints: ["src/render_entry.ts"],
	globalName: "LatexSnippetsRender",
	outfile: "build/render.js",
};

// A third, ESM build of the pure parts, so test.js can exercise the engine
// outside Zotero.
const testOpts = {
	...opts,
	entryPoints: ["src/test_exports.ts"],
	format: "esm",
	platform: "neutral",
	outfile: "build/test-exports.mjs",
};

// KaTeX is shipped as-is rather than bundled: the note editor never needs it,
// so it is injected only into reader windows and loaded separately in chrome.
// Copied from node_modules on every build so it cannot drift from package.json.
await fs.mkdir("vendor", { recursive: true });
for (const [from, to] of [
	["node_modules/katex/dist/katex.min.js", "vendor/katex.min.js"],
	["node_modules/katex/LICENSE", "vendor/KATEX-LICENSE"],
]) {
	await fs.copyFile(from, to);
}

if (process.argv.includes("--watch")) {
	const ctx = await esbuild.context(opts);
	await ctx.watch();
} else {
	await esbuild.build(opts);
	await esbuild.build(renderOpts);
	await esbuild.build(testOpts);
}
