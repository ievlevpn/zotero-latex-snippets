/* Faithfulness to obsidian-latex-suite.
 *
 * Every example in upstream's DOCS.md, run against this engine. The snippet
 * format is the compatibility promise of this plugin — someone's vault file has
 * to behave the same here — so the docs are the specification and this is the
 * conformance suite.
 */
import assert from "node:assert";
import * as ls from "./build/test-exports.mjs";

const compile = (source, variables = {}) => ls.parseSnippets(source, variables, "compat");
const one = (snippet, variables) => compile(`export default [${snippet}]`, variables)[0];

/** Run a snippet the way the engine does when `key` completes its trigger. */
function fire(snippet, before, key = "", { selection = "", after = "" } = {}) {
	const result = snippet.process({
		effectiveLine: before + key,
		range: { from: before.length - selection.length, to: before.length },
		sel: selection,
		effectiveLineAfter: () => after,
		api: {},
	});
	if (!result) return null;
	return {
		insert: result.replacement.insert,
		triggerPos: result.triggerPos,
		tabstops: result.replacement.tabstops.map((t) => [t.index[0], t.from, t.to]),
	};
}

export function run() {
	/* --- DOCS: Tabstops --- */
	{
		const frac = one(`{trigger: "//", replacement: "\\\\frac{$0}{$1}$2", options: "mA"}`);
		assert.strictEqual(fire(frac, "/", "/").insert, "\\frac{}{}");

		const dint = one(`{trigger: "dint", replacement: "\\\\int_{\${0:0}}^{\${1:\\\\infty}} $2 d\${3:x}", options: "mA"}`);
		const dintResult = fire(dint, "din", "t");
		assert.strictEqual(dintResult.insert, "\\int_{0}^{\\infty}  dx");
		assert.deepStrictEqual(
			dintResult.tabstops.map(([i]) => i),
			[0, 1, 2, 3],
			"one tabstop per ${X:…} and $X, in order",
		);

		// "Tabstops with the same number will all be selected at the same time."
		const outp = one(`{trigger: "outp", replacement: "\\\\ket{\${0:\\\\psi}} \\\\bra{\${0:\\\\psi}} $1", options: "mA"}`);
		const outpResult = fire(outp, "out", "p");
		assert.strictEqual(outpResult.insert, "\\ket{\\psi} \\bra{\\psi} ");
		const groups = ls.tabstopSpecsToTabstopGroups(
			outpResult.tabstops.map(([index, from, to]) => ({ index: [index], from, to })),
		);
		assert.strictEqual(groups.length, 2, "$0 twice and $1 once is two groups");
		assert.strictEqual(groups[0].length, 2, "both $0 occurrences belong to one group");
	}

	/* --- DOCS: Regex snippets --- */
	{
		const viaOption = one(`{trigger: "([A-Za-z])(\\\\d)", replacement: "[[0]]_{[[1]]}", options: "rA"}`);
		assert.strictEqual(fire(viaOption, "x", "2").insert, "x_{2}");

		// "Using a RegExp literal, the same snippet can be written as…"
		const viaLiteral = one(`{trigger: /([A-Za-z])(\\d)/, replacement: "[[0]]_{[[1]]}", options: "A"}`);
		assert.strictEqual(viaLiteral.type, "regex", "a RegExp trigger is a regex snippet without the r option");
		assert.strictEqual(fire(viaLiteral, "x", "2").insert, "x_{2}");

		// flags
		const insensitive = one(`{trigger: "([a-z])!", replacement: "[[0]]?", options: "rA", flags: "i"}`);
		assert.strictEqual(fire(insensitive, "X", "!").insert, "X?");
		const literalFlags = one(`{trigger: /([a-z])!/i, replacement: "[[0]]?", options: "A"}`);
		assert.strictEqual(fire(literalFlags, "X", "!").insert, "X?");
		// invalid flags are dropped rather than throwing
		assert.ok(one(`{trigger: "a", replacement: "b", options: "rA", flags: "gyi"}`).trigger.flags === "i");
	}

	/* --- DOCS: Snippet variables --- */
	{
		const variables = ls.parseSnippetVariables(
			`export default {
				"\${GREEK}": "(?:alpha|beta)",
				"SYMBOL": "(?:oplus|otimes)",
				MORE: "(?:leq|geq)",
			}`,
			"compat",
		);
		assert.deepStrictEqual(
			Object.keys(variables).sort(),
			["${GREEK}", "${MORE}", "${SYMBOL}"],
			"all three spellings of a variable name are accepted",
		);

		const greek = one(`{trigger: "@\${GREEK}", replacement: "\\\\\\\\[[0]]", options: "rmA"}`, variables);
		assert.ok(greek.trigger.source.includes("alpha"), "variables are substituted into the trigger");
	}

	/* --- DOCS: Visual snippets --- */
	{
		const underbrace = one(`{trigger: "U", replacement: "\\\\underbrace{ \${VISUAL} }_{ $0 }", options: "mA"}`);
		assert.strictEqual(underbrace.type, "visual", "a \${VISUAL} replacement is a visual snippet");
		assert.strictEqual(
			fire(underbrace, "abU", "", { selection: "ab" }).insert,
			"\\underbrace{ ab }_{  }",
		);
		assert.strictEqual(fire(underbrace, "U", ""), null, "visual snippets need a selection");

		// the v option with a function replacement
		const cancel = one(`{trigger: "K", replacement: (sel) => ("\\\\cancelto{ $0 }{" + sel + "}"), options: "mv"}`);
		const cancelResult = fire(cancel, "abK", "", { selection: "ab" });
		assert.strictEqual(cancelResult.insert, "\\cancelto{  }{ab}");
		assert.deepStrictEqual(cancelResult.tabstops, [[0, 11, 11]], "tabstops in a returned string still expand");

		// returning false means "do nothing"
		const hyphen = one(
			`{trigger: "-", replacement: sel => { if (!sel.includes(" ")) { return false } return sel.replaceAll(/\\s+/g, "-")}, options: "vA"}`,
		);
		assert.strictEqual(fire(hyphen, "hello world-", "", { selection: "hello world" }).insert, "hello-world");
		assert.strictEqual(fire(hyphen, "hello-", "", { selection: "hello" }), null);
	}

	/* --- DOCS: Function snippets --- */
	{
		const date = one(`{trigger: "date", replacement: () => ("A DATE"), options: "t"}`);
		assert.strictEqual(fire(date, "dat", "e").insert, "A DATE");

		// The identity-matrix example, verbatim from DOCS.md. String.raw so that
		// what is written here is exactly what the snippet file would contain.
		const iden = one(String.raw`{trigger: /iden(\d)/, replacement: (match) => {
			const n = match[1];
			let arr = [];
			for (let j = 0; j < n; j++) { arr[j] = []; for (let i = 0; i < n; i++) arr[j][i] = (i === j) ? 1 : 0; }
			let output = arr.map(el => el.join(" & ")).join(" \\\\\n");
			return "\\begin{pmatrix}\n" + output + "\n\\end{pmatrix}";
		}, options: "mA", description: "N x N identity matrix"}`);
		const matrix = fire(iden, "iden", "2");
		assert.strictEqual(matrix.insert, "\\begin{pmatrix}\n1 & 0 \\\\\n0 & 1\n\\end{pmatrix}");
		assert.strictEqual(iden.description, "N x N identity matrix");

		// "If a snippet replacement function returns a non-string value, the
		// snippet is ignored and will not expand."
		assert.strictEqual(fire(one(`{trigger: "q", replacement: () => 42, options: "mA"}`), "", "q"), null);
		assert.strictEqual(fire(one(`{trigger: "q", replacement: () => null, options: "mA"}`), "", "q"), null);
	}

	/* --- DOCS: Nodes --- */
	{
		const sum = one(String.raw`{trigger: /(\d+)\+(\d+)/, replacement: (match) => {
			const ls = require("latex-suite");
			return [ls.text_node("$" + match[1] + "+" + match[2] + "=" + (parseInt(match[1]) + parseInt(match[2])) + "$")];
		}, options: "t"}`);
		assert.strictEqual(fire(sum, "1+", "2").insert, "$1+2=3$");

		// The visual-fraction example from DOCS.md#nodes.
		const fraction = one(String.raw`{trigger: "/", replacement: (() => {
			const ls = require("latex-suite");
			return [ls.text_node("\\frac{"), ls.capture_node("$" + "{VISUAL}"), ls.text_node("}{"), ls.tabstop_node(0), ls.text_node("}")];
		})(), options: "mv"}`);
		const fractionResult = fire(fraction, "a+b/", "", { selection: "a+b" });
		assert.strictEqual(fractionResult.insert, "\\frac{a+b}{}");
		assert.deepStrictEqual(fractionResult.tabstops, [[0, 11, 11]]);

		// capture_node by number, and its default when the group did not match
		const byNumber = one(String.raw`{trigger: /x(\d)?/, replacement: (() => {
			const ls = require("latex-suite");
			return [ls.text_node("X"), ls.capture_node(0, "none")];
		})(), options: "rmA"}`);
		assert.strictEqual(fire(byNumber, "x", "1").insert, "X1");
		assert.strictEqual(fire(byNumber, "", "x").insert, "Xnone", "a missing group falls back to the default");

		// capture_node by named group
		const named = one(String.raw`{trigger: /(?<digit>\d)!/, replacement: (() => {
			const ls = require("latex-suite");
			return [ls.text_node("!"), ls.capture_node("digit")];
		})(), options: "rmA"}`);
		assert.strictEqual(fire(named, "7", "!").insert, "!7", "named capture groups reach capture_node");

		// the api also exposes the snippet variables
		const seesVariables = compile(
			String.raw`const ls = require("latex-suite");
			export default [{trigger: ls.snippetVariables["$" + "{V}"], replacement: "ok", options: "mA"}]`,
			{ "${V}": "zz" },
		)[0];
		assert.strictEqual(seesVariables.trigger, "zz");
	}

	/* --- DOCS: priority, and longer triggers first --- */
	{
		const sorted = compile(`export default [
			{trigger: "a", replacement: "1", options: "mA"},
			{trigger: "abc", replacement: "3", options: "mA"},
			{trigger: "ab", replacement: "2", options: "mA"},
			{trigger: "z", replacement: "0", options: "mA", priority: 3},
			{trigger: "y", replacement: "-", options: "mA", priority: -1},
		]`);
		assert.deepStrictEqual(sorted.map((s) => s.trigger), ["z", "abc", "ab", "a", "y"]);
	}

	/* --- DOCS: option letters --- */
	{
		const modeOf = (options) => one(`{trigger: "x", replacement: "y", options: "${options}"}`).options;

		assert.ok(modeOf("A").automatic);
		assert.ok(!modeOf("").automatic);
		assert.ok(modeOf("w").onWordBoundary);
		assert.ok(modeOf("r").regex);
		assert.ok(modeOf("v").visual);
		assert.ok(modeOf("").undoKey && !modeOf("U").undoKey);

		// t / m / n / M / T / c / C
		assert.ok(modeOf("t").mode.text && !modeOf("t").mode.inlineMath);
		assert.ok(modeOf("m").mode.inlineMath && modeOf("m").mode.blockMath && !modeOf("m").mode.text);
		assert.ok(modeOf("n").mode.inlineMath && !modeOf("n").mode.blockMath);
		assert.ok(modeOf("M").mode.blockMath && !modeOf("M").mode.inlineMath);
		assert.ok(modeOf("T").mode.textEnv, "T is math text mode");
		assert.ok(modeOf("c").mode.codeBlock === true);
		assert.ok(modeOf("C").mode.code);

		// "No mode specified means that this snippet can be triggered at all times."
		const catchAll = modeOf("A").mode;
		assert.ok(catchAll.text && catchAll.inlineMath && catchAll.blockMath && catchAll.code);
	}

	/* --- DOCS: excludedEnvironments / excludedMacros / includedMacros --- */
	{
		const scopes = (equation) => ls.scanScopes(equation, equation.length);

		const excludedEnv = one(`{trigger: "x", replacement: "y", options: "mA", excludedEnvironments: ["pmatrix"]}`);
		assert.strictEqual(excludedEnv.isWithinExcludedScope(scopes("\\begin{pmatrix} ")), true);
		assert.strictEqual(excludedEnv.isWithinExcludedScope(scopes("\\begin{align} ")), false);

		const excludedMacro = one(`{trigger: "x", replacement: "y", options: "mA", excludedMacros: ["ce"]}`);
		assert.strictEqual(excludedMacro.isWithinExcludedScope(scopes("\\ce{")), true);
		assert.strictEqual(excludedMacro.isWithinExcludedScope(scopes("\\text{")), false);

		// object form with argument indices
		const byArgument = one(
			`{trigger: "x", replacement: "y", options: "mA", excludedMacros: [{name: "textcolor", arguments: [0]}]}`,
		);
		assert.strictEqual(byArgument.isWithinExcludedScope(scopes("\\textcolor{")), true, "first argument excluded");
		assert.strictEqual(byArgument.isWithinExcludedScope(scopes("\\textcolor{red}{")), false, "second is not");

		const included = one(`{trigger: "x", replacement: "y", options: "mA", includedMacros: ["color"]}`);
		assert.strictEqual(included.isWithinIncludedScope(scopes("\\color{")), ls.IncludedEnvironmentResult.Included);
		assert.strictEqual(included.isWithinIncludedScope(scopes("")), ls.IncludedEnvironmentResult.NotIncluded);

		// the built-in exclusions from upstream's environment.ts
		const subscript = one(`{trigger: "([A-Za-z])(\\\\d)", replacement: "[[0]]_{[[1]]}", options: "rA"}`);
		assert.strictEqual(subscript.isWithinExcludedScope(scopes("\\ce{")), true, "x2 must not fire inside \\ce{}");
	}

	/* --- snippet files: nested arrays are flattened, as upstream does --- */
	{
		const nested = compile(`const a = [{trigger: "a", replacement: "1", options: "mA"}];
			const b = [{trigger: "b", replacement: "2", options: "mA"}];
			export default [a, b]`);
		assert.strictEqual(nested.length, 2, "an array of arrays is flattened");
	}

	/* --- a bare array, with no export default, is accepted --- */
	{
		const bare = ls.parseSnippets(`[{trigger: "a", replacement: "1", options: "mA"}]`, {}, "compat");
		assert.strictEqual(bare.length, 1);
	}

	/* --- triggerKey --- */
	{
		const bound = one(`{trigger: "x", replacement: "y", options: "m", triggerKey: "Ctrl-a"}`);
		assert.strictEqual(bound.triggerKey, "Ctrl-a");
		assert.strictEqual(
			ls.keyNameFromEvent({ key: "a", ctrlKey: true, shiftKey: false, altKey: false, metaKey: false }),
			"Ctrl-a",
		);
		const mod = one(`{trigger: "x", replacement: "y", options: "m", triggerKey: "Mod-b"}`);
		assert.ok(mod.triggerKey === "Meta-b" || mod.triggerKey === "Ctrl-b", "Mod- resolves per platform");
	}

	/* --- DOCS: snippet files, including the .md wrapper --- */
	{
		// "A snippets file that can be edited by obsidian", DOCS.md#snippet-files
		const md = [
			"/*",
			"Prose about my snippets, which Obsidian renders.",
			"```javascript",
			"*/",
			`const greek = [{trigger: "@a", replacement: "\\\\alpha", options: "mA"}];`,
			`const matrices = [{trigger: "pmat", replacement: "\\\\begin{pmatrix}$0\\\\end{pmatrix}", options: "MA"}];`,
			"export default [...greek, ...matrices];",
			"/*",
			"```",
			"*/",
		].join("\n");
		assert.deepStrictEqual(compile(md).map((s) => s.trigger).sort(), ["@a", "pmat"]);

		// a folder of snippet files: concatenated, then sorted as one list
		const folder = ls.parseSnippets(
			[
				`export default [{trigger: "a", replacement: "1", options: "mA"}]`,
				`export default [{trigger: "bb", replacement: "2", options: "mA", priority: 5}]`,
			],
			{},
			"folder",
		);
		assert.deepStrictEqual(folder.map((s) => s.trigger), ["bb", "a"], "priority applies across files");

		// variables from several files are merged
		const merged = ls.parseSnippetVariables(
			[`export default {A: "x"}`, `export default {B: "y"}`],
			"folder",
		);
		assert.deepStrictEqual(Object.keys(merged).sort(), ["${A}", "${B}"]);
	}

	/* --- a RegExp subclass keeps its own engine, as upstream allows --- */
	{
		const custom = compile(
			`class MyRe extends RegExp {}\nexport default [{trigger: new MyRe("z(\\\\d)"), replacement: "Z[[0]]", options: "mA"}]`,
		)[0];
		assert.strictEqual(custom.trigger.constructor.name, "MyRe");
		assert.strictEqual(fire(custom, "z", "1").insert, "Z1");
	}

	console.log("latex-suite compatibility tests passed");
}
