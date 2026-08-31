/* Self-check: node test.js
 *
 * Exercises the snippet engine outside Zotero (build/test-exports.mjs) and
 * checks that the settings-pane defaults in bootstrap.js still match the
 * engine's own defaults.
 */
const assert = require("assert");
const { FIELDS } = require("./bootstrap.js");

(async () => {
	const ls = await import("./build/test-exports.mjs");
	const { DEFAULT_SETTINGS, processSettings, parseSnippets, parseSnippetVariables } = ls;

	/* --- the two default tables agree --- */
	for (const field of FIELDS) {
		assert.deepStrictEqual(
			field.default,
			DEFAULT_SETTINGS[field.key],
			`bootstrap.js default for "${field.key}" has drifted from src/settings/settings.ts`,
		);
	}

	/* --- the shipped snippets parse --- */
	const settings = processSettings(DEFAULT_SETTINGS);
	assert.ok(settings.snippets.length > 200, "expected the full default snippet set");
	assert.deepStrictEqual(settings.matrixShortcutsEnvNames.includes("pmatrix"), true);
	assert.deepStrictEqual(settings.autofractionExcludedEnvs, [
		{ openSymbol: "^{", closeSymbol: "}" },
		{ openSymbol: "\\pu{", closeSymbol: "}" },
	]);
	assert.deepStrictEqual(settings.autoEnlargeBracketsTriggers, [
		"\\sum", "\\int", "\\frac", "\\prod", "\\bigcup", "\\bigcap",
	]);

	/* --- snippets are sorted by priority, then trigger length --- */
	const sorted = parseSnippets(
		`export default [
			{trigger: "a", replacement: "1", options: "mA"},
			{trigger: "abc", replacement: "3", options: "mA"},
			{trigger: "zz", replacement: "2", options: "mA", priority: 5},
		]`,
		{},
		"test",
	);
	assert.deepStrictEqual(sorted.map((s) => s.trigger), ["zz", "abc", "a"]);

	/* --- option letters --- */
	const one = parseSnippets(`export default [{trigger: "x", replacement: "y", options: "mAw"}]`, {}, "test")[0];
	assert.ok(one.options.automatic && one.options.onWordBoundary);
	assert.ok(one.options.mode.inlineMath && one.options.mode.blockMath && !one.options.mode.text);

	/* --- tabstops and captures --- */
	const frac = parseSnippets(`export default [{trigger: "//", replacement: "\\\\frac{$0}{$1}$2", options: "mA"}]`, {}, "test")[0];
	const fracResult = frac.process({
		effectiveLine: "//", range: { from: 2, to: 2 }, sel: "", effectiveLineAfter: () => "", api: {},
	});
	assert.strictEqual(fracResult.replacement.insert, "\\frac{}{}");
	assert.deepStrictEqual(
		fracResult.replacement.tabstops.map((t) => [t.index[0], t.from, t.to]),
		[[0, 6, 6], [1, 8, 8], [2, 9, 9]],
	);

	/* --- placeholders --- */
	const dint = parseSnippets(
		`export default [{trigger: "dint", replacement: "\\\\int_{\${0:0}}^{\${1:\\\\infty}} $2", options: "mA"}]`,
		{}, "test",
	)[0];
	const dintResult = dint.process({
		effectiveLine: "dint", range: { from: 4, to: 4 }, sel: "", effectiveLineAfter: () => "", api: {},
	});
	assert.strictEqual(dintResult.replacement.insert, "\\int_{0}^{\\infty} ");

	/* --- regex snippets and ${VARIABLE} substitution --- */
	const variables = parseSnippetVariables(`export default { GREEK: "(?:alpha|beta)" }`, "test");
	assert.deepStrictEqual(Object.keys(variables), ["${GREEK}"]);
	const greek = parseSnippets(
		`export default [{trigger: "@\${GREEK}", replacement: "\\\\\\\\[[0]]", options: "rmA"}]`,
		variables, "test",
	)[0];
	assert.ok(greek.trigger.source.includes("alpha"));

	const sub = parseSnippets(`export default [{trigger: /([A-Za-z])(\\d)/, replacement: "[[0]]_{[[1]]}", options: "mA"}]`, {}, "test")[0];
	const subResult = sub.process({
		effectiveLine: "x2", range: { from: 2, to: 2 }, sel: "", effectiveLineAfter: () => "", api: {},
	});
	assert.strictEqual(subResult.replacement.insert, "x_{2}");
	assert.strictEqual(subResult.triggerPos, 0);

	/* --- visual snippets --- */
	const visual = parseSnippets(
		`export default [{trigger: "U", replacement: "\\\\underbrace{ \${VISUAL} }_{ $0 }", options: "mA"}]`,
		{}, "test",
	)[0];
	assert.strictEqual(visual.type, "visual");
	const visualResult = visual.process({
		effectiveLine: "abU", range: { from: 0, to: 2 }, sel: "ab", effectiveLineAfter: () => "", api: {},
	});
	assert.strictEqual(visualResult.replacement.insert, "\\underbrace{ ab }_{  }");
	// no selection -> no expansion
	assert.strictEqual(
		visual.process({ effectiveLine: "U", range: { from: 0, to: 0 }, sel: "", effectiveLineAfter: () => "", api: {} }),
		null,
	);

	/* --- function replacements --- */
	const fn = parseSnippets(
		`export default [{trigger: "iden", replacement: (m) => m.toUpperCase(), options: "mA"}]`, {}, "test",
	)[0];
	assert.strictEqual(
		fn.process({ effectiveLine: "iden", range: { from: 4, to: 4 }, sel: "", effectiveLineAfter: () => "", api: {} })
			.replacement.insert,
		"IDEN",
	);
	// a non-string, non-node return means "don't expand"
	const fnFalse = parseSnippets(`export default [{trigger: "q", replacement: () => false, options: "mA"}]`, {}, "test")[0];
	assert.strictEqual(
		fnFalse.process({ effectiveLine: "q", range: { from: 1, to: 1 }, sel: "", effectiveLineAfter: () => "", api: {} }),
		null,
	);

	/* --- the node API --- */
	const nodes = parseSnippets(
		`const ls = require("latex-suite");
		export default [{
			trigger: /(\\d+)\\+(\\d+)/,
			replacement: (m) => [ls.text_node(m[1] + "+" + m[2] + "="), ls.tabstop_node(0)],
			options: "mA",
		}]`,
		{}, "test",
	)[0];
	assert.strictEqual(
		nodes.process({ effectiveLine: "1+2", range: { from: 3, to: 3 }, sel: "", effectiveLineAfter: () => "", api: {} })
			.replacement.insert,
		"1+2=",
	);

	/* --- tabstop grouping: same index -> same group, sorted --- */
	const groups = ls.tabstopSpecsToTabstopGroups([
		{ index: [1], from: 5, to: 5 },
		{ index: [0], from: 0, to: 2 },
		{ index: [0], from: 8, to: 10 },
	]);
	assert.deepStrictEqual(groups, [
		[{ from: 0, to: 2 }, { from: 8, to: 10 }],
		[{ from: 5, to: 5 }],
	]);

	/* --- scope scanning: what the mode checks run on --- */
	const eq = "\\begin{pmatrix} a & \\text{b";
	const scopes = ls.scanScopes(eq, eq.length);
	assert.deepStrictEqual(
		scopes.map((s) => [s.kind, s.name, s.argIndex]),
		[["command", "text", 0], ["environment", "pmatrix", 0]],
	);
	// closing the macro's argument pops it, the environment stays
	const closed = "\\begin{pmatrix} \\text{b} c";
	assert.deepStrictEqual(
		ls.scanScopes(closed, closed.length).map((s) => s.name),
		["pmatrix"],
	);
	// second argument of a two-argument macro
	const second = "\\textcolor{red}{x";
	assert.deepStrictEqual(
		ls.scanScopes(second, second.length).map((s) => [s.name, s.argIndex]),
		[["textcolor", 1]],
	);
	// a bare group after ^ is named for it, so autofraction's excluded envs match
	const sup = "x^{a";
	assert.deepStrictEqual(ls.scanScopes(sup, sup.length).map((s) => [s.kind, s.name]), [["group", "^"]]);

	/* --- text-mode $…$ becomes an equation --- */
	const mk = ls.asMathReplacement({ insert: "$$", tabstops: [{ index: [0], from: 1, to: 1 }] });
	assert.deepStrictEqual(mk, { display: false, inner: { insert: "", tabstops: [{ index: [0], from: 0, to: 0 }] } });

	const dm = ls.asMathReplacement({ insert: "$$\n\n$$", tabstops: [{ index: [0], from: 3, to: 3 }] });
	assert.strictEqual(dm.display, true);
	assert.strictEqual(dm.inner.insert, "");
	assert.deepStrictEqual(dm.inner.tabstops, [{ index: [0], from: 0, to: 0 }]);

	assert.strictEqual(ls.asMathReplacement({ insert: "\\alpha", tabstops: [] }), null);
	assert.strictEqual(ls.asMathReplacement({ insert: "a$b$c", tabstops: [] }), null);

	/* --- key names round-trip between the settings format and real events --- */
	assert.strictEqual(ls.parseKeyName("Shift-Tab"), "Shift-Tab");
	assert.strictEqual(
		ls.keyNameFromEvent({ key: "Tab", shiftKey: true, ctrlKey: false, altKey: false, metaKey: false }),
		"Shift-Tab",
	);
	assert.strictEqual(ls.parseKeyName("Ctrl-a"), "Ctrl-a");
	assert.strictEqual(
		ls.keyNameFromEvent({ key: "a", shiftKey: false, ctrlKey: true, altKey: false, metaKey: false }),
		"Ctrl-a",
	);

	/* --- the built bundle installs, reloads and uninstalls cleanly --- */
	const fs = require("fs");
	const bundle = fs.readFileSync(__dirname + "/build/content-script.js", "utf8");
	const events = [];
	const win = {
		document: {
			addEventListener: (type) => events.push("+" + type),
			removeEventListener: (type) => events.push("-" + type),
			activeElement: null,
		},
	};
	new Function("window", "navigator", "console", bundle)(win, { userAgent: "Mac" }, console);
	assert.deepStrictEqual(events, ["+keydown", "+beforeinput"]);
	assert.strictEqual(win.__latexSnippetsInstalled, true);
	assert.ok(win.__latexSnippets.settings.snippets.length > 200);

	win.__latexSnippetsReload(JSON.stringify({ snippets: `export default [{trigger: "zz", replacement: "ZZ", options: "mA"}]` }));
	assert.deepStrictEqual(win.__latexSnippets.settings.snippets.map((s) => s.trigger), ["zz"]);

	// Broken snippets fall back to the defaults rather than leaving no engine.
	const realError = console.error;
	console.error = () => {}; // the fallback logs the syntax error, as it should
	win.__latexSnippetsReload(JSON.stringify({ snippets: "export default not valid js {{{" }));
	console.error = realError;
	assert.ok(win.__latexSnippets.settings.snippets.length > 200);

	win.__latexSnippetsUninstall();
	assert.deepStrictEqual(events, ["+keydown", "+beforeinput", "-keydown", "-beforeinput"]);
	assert.strictEqual(win.__latexSnippetsInstalled, undefined);

	const editor = await import("./test-editor.mjs");
	editor.run();

	console.log("all tests passed");
})().catch((e) => {
	console.error(e);
	process.exit(1);
});
