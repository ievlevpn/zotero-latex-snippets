/* LaTeX Snippets — a Zotero plugin (bootstrapped, Zotero 7+).
 *
 * A port of the snippets half of obsidian-latex-suite to Zotero's note editor.
 * This file is the chrome side and does three small things:
 *
 *   1. Registers the settings pane.
 *   2. Injects build/content-script.js into every note-editor and reader iframe.
 *      The engine has to run *inside* those windows: it drives Zotero's own
 *      ProseMirror instance and its React annotation fields, and reaching those
 *      objects from chrome across Xray wrappers would be misery.
 *   3. Renders `$…$` in the item pane's annotation rows, which are chrome rather
 *      than reader content, so the injected bundle cannot reach them.
 *   4. Pushes settings changes through to the editors that are already open.
 *
 * See notes/zotero-note-editor.md for how the note editor is put together.
 */

const PREF = "extensions.zotero.latexSnippets.settings";

/* Scalar defaults, mirrored from src/settings/settings.ts, which is the source
 * of truth — the content script merges the stored overrides over its own copy.
 * These exist so the settings pane can show what a field falls back to.
 * test.js fails if the two drift apart. */
const FIELDS = [
	{ group: "Snippets", key: "snippetsEnabled", type: "bool", default: true,
		label: "Enable snippets" },
	{ group: "Snippets", key: "snippetsTrigger", type: "text", default: "Tab",
		label: "Expand a snippet", hint: "Key that expands a non-automatic snippet." },
	{ group: "Snippets", key: "snippetNextTabstopTrigger", type: "text", default: "Tab",
		label: "Next tabstop" },
	{ group: "Snippets", key: "snippetPreviousTabstopTrigger", type: "text", default: "Shift-Tab",
		label: "Previous tabstop" },
	{ group: "Snippets", key: "removeSnippetWhitespace", type: "bool", default: true,
		label: "Remove trailing whitespace in inline math" },
	{ group: "Snippets", key: "snippetRecursion", type: "number", default: 0,
		label: "Recursive expansions", hint: "How many times an expansion may itself trigger another snippet." },

	{ group: "Auto-fraction", key: "autofractionEnabled", type: "bool", default: true,
		label: "Enable auto-fraction" },
	{ group: "Auto-fraction", key: "autofractionTrigger", type: "text", default: "/",
		label: "Trigger" },
	{ group: "Auto-fraction", key: "autofractionSymbol", type: "text", default: "\\frac",
		label: "Fraction command" },
	{ group: "Auto-fraction", key: "autofractionBreakingChars", type: "text", default: "+-=\t",
		label: "Breaking characters", hint: "Characters that end the numerator." },
	{ group: "Auto-fraction", key: "autofractionExcludedEnvs", type: "code", rows: 4,
		default: `[\n\t\t["^{", "}"],\n\t\t["\\\\pu{", "}"]\n\t]`,
		label: "Excluded environments", hint: "JSON array of [open, close] pairs." },

	{ group: "Matrix shortcuts", key: "matrixShortcutsEnabled", type: "bool", default: true,
		label: "Enable matrix shortcuts" },
	{ group: "Matrix shortcuts", key: "matrixShortcutsCellTrigger", type: "text", default: "Tab",
		label: "New cell" },
	{ group: "Matrix shortcuts", key: "matrixShortcutsNewlineTrigger", type: "text", default: "Enter",
		label: "New row" },
	{ group: "Matrix shortcuts", key: "matrixShortcutsExitTrigger", type: "text", default: "Shift-Enter",
		label: "Leave" },
	{ group: "Matrix shortcuts", key: "matrixShortcutsEnvNames", type: "text",
		default: "pmatrix, cases, align, gather, bmatrix, Bmatrix, vmatrix, Vmatrix, array, matrix",
		label: "Environments" },
	{ group: "Matrix shortcuts", key: "matrixShortcutsMacroNames", type: "text", default: "eqalign",
		label: "Macros" },

	{ group: "Tabout", key: "taboutEnabled", type: "bool", default: true,
		label: "Enable tabout" },
	{ group: "Tabout", key: "taboutTrigger", type: "text", default: "Tab",
		label: "Trigger" },
	{ group: "Tabout", key: "taboutExitEquationOnlyOnEOL", type: "bool", default: true,
		label: "Only leave an equation from its end" },
	{ group: "Tabout", key: "taboutClosingSymbols", type: "text",
		default: "), ], \\rbrack, \\}, \\rbrace, \\rangle, \\rvert, \\rVert, \\rfloor, \\rceil, \\urcorner, }",
		label: "Closing symbols" },

	{ group: "Brackets", key: "autoEnlargeBrackets", type: "bool", default: true,
		label: "Auto-enlarge brackets" },
	{ group: "Brackets", key: "autoEnlargeBracketsSpace", type: "bool", default: true,
		label: "Add a space after \\left / before \\right" },
	{ group: "Brackets", key: "autoEnlargeBracketsTriggers", type: "text",
		default: "sum, int, frac, prod, bigcup, bigcap",
		label: "Triggers", hint: "Commands inside a bracket pair that make it worth enlarging." },

	{ group: "Annotations", key: "annotationSnippetsEnabled", type: "bool", default: true,
		label: "Snippets in annotation comments",
		hint: "Comments are plain text, so equations there are written as $\u2026$, the way they are in Markdown." },
	{ group: "Annotations", key: "annotationMathEnabled", type: "bool", default: true,
		label: "Render math in annotations",
		hint: "Shows $\u2026$ as an equation when the comment is not being edited." },

	{ group: "Advanced", key: "wordDelimiters", type: "text",
		default: "., +-\\n\t:;!?\\/{}[]()=~$'\"|`<>*^%#@&",
		label: "Word delimiters", hint: "Used by the \"w\" (word boundary) snippet option." },
	{ group: "Advanced", key: "snippetDebug", type: "select", default: "off",
		options: ["off", "info", "verbose"], label: "Log expansions to the console" },
];

let rootURI = null;
let contentScript = null;
let katexScript = null;
let defaultSnippets = "";
let defaultSnippetVariables = "";
let prefPane = null;
let prefObserver = null;
let origRegisterEditorInstance = null;
let onReaderEvent = null;

/* --- settings ------------------------------------------------------------ */

function readOverrides() {
	try {
		const raw = Zotero.Prefs.get(PREF, true);
		const parsed = raw ? JSON.parse(raw) : null;
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
	} catch (e) {
		Zotero.debug("LaTeX Snippets: unreadable settings pref - " + e);
		return {};
	}
}

// Only the overrides travel; the content script merges them over its own
// defaults, so an unset field always follows the shipped default.
function settingsJSON() {
	return JSON.stringify(readOverrides());
}

/* --- injection ----------------------------------------------------------- */

function runScript(doc, source) {
	// A <script> element, not eval from chrome: the engine needs native access to
	// the page's own objects, and these are resource:// pages with no CSP (they
	// already run inline scripts of Zotero's own).
	const script = doc.createElement("script");
	script.textContent = source;
	doc.documentElement.appendChild(script);
	script.remove();
}

function inject(win, { withKatex } = {}) {
	const doc = win.document;
	if (!doc || !doc.documentElement) return;

	const content = win.wrappedJSObject;
	content.__latexSnippetsSettings = settingsJSON();

	if (content.__latexSnippetsInstalled) {
		if (content.__latexSnippetsReload) content.__latexSnippetsReload(settingsJSON());
		return;
	}

	// Only the reader needs a renderer; notes have Zotero's own KaTeX.
	if (withKatex && !content.katex) runScript(doc, katexScript);
	runScript(doc, contentScript);
}

function attach(instance) {
	const win = instance && instance._iframeWindow;
	if (!win) return;
	const doc = win.document;
	if (!doc || doc.readyState === "loading") {
		win.addEventListener("DOMContentLoaded", () => inject(win), { once: true });
	} else {
		inject(win);
	}
}

function attachReader(reader) {
	const win = reader && reader._iframeWindow;
	if (!win) return;
	const doc = win.document;
	if (!doc || doc.readyState === "loading") {
		win.addEventListener("DOMContentLoaded", () => inject(win, { withKatex: true }), { once: true });
	} else {
		inject(win, { withKatex: true });
	}
}

/** Every window the engine is running in: note editors and readers alike. */
function eachTarget(fn) {
	const windows = [
		...(Zotero.Notes._editorInstances || []).map((x) => x && x._iframeWindow),
		...(Zotero.Reader._readers || []).map((x) => x && x._iframeWindow),
	];
	for (const win of windows) {
		try {
			if (win) fn(win);
		} catch (e) {
			Zotero.debug("LaTeX Snippets: " + e);
		}
	}
}

function onSettingsChanged() {
	const json = settingsJSON();
	eachTarget((win) => {
		const content = win.wrappedJSObject;
		if (content.__latexSnippetsReload) content.__latexSnippetsReload(json);
	});
	for (const win of itemPaneWindows.keys()) itemPaneWindows.get(win).refresh();
}

/* --- the item pane's annotation rows ------------------------------------- */

/* Those rows are chrome, not reader content, so the injected bundle cannot see
 * them. They are read-only, which makes this the easy half: render and leave it
 * alone — there is no editing to put the `$…$` back for. */
const itemPaneWindows = new Map();

const ROW_SELECTOR = "annotation-row .comment";

function installItemPaneRendering(window) {
	const doc = window.document;
	const root = doc.getElementById("zotero-item-pane") || doc.documentElement;
	if (!root) return null;

	Services.scriptloader.loadSubScript(rootURI + "vendor/katex.min.js", window);
	Services.scriptloader.loadSubScript(rootURI + "build/render.js", window);
	const render = window.LatexSnippetsRender;
	const katex = window.katex;
	if (!render || !katex) {
		Zotero.debug("LaTeX Snippets: renderer failed to load in the item pane");
		return null;
	}

	let scheduled = 0;
	const enabled = () => readOverrides().annotationMathEnabled !== false;

	const tick = () => {
		scheduled = 0;
		for (const el of doc.querySelectorAll(ROW_SELECTOR)) {
			if (enabled()) render.renderMath(el, katex);
			else render.unrenderMath(el);
		}
	};
	const schedule = () => {
		if (!scheduled) scheduled = window.requestAnimationFrame(tick);
	};

	const observer = new window.MutationObserver(schedule);
	observer.observe(root, { childList: true, subtree: true, characterData: true });
	schedule();

	return {
		refresh: schedule,
		destroy() {
			observer.disconnect();
			if (scheduled) window.cancelAnimationFrame(scheduled);
			for (const el of doc.querySelectorAll(ROW_SELECTOR)) render.unrenderMath(el);
		},
	};
}

function onMainWindowLoad({ window }) {
	if (!rootURI || itemPaneWindows.has(window)) return;
	try {
		const handle = installItemPaneRendering(window);
		if (handle) itemPaneWindows.set(window, handle);
	} catch (e) {
		Zotero.debug("LaTeX Snippets: item pane rendering failed - " + e);
	}
}

function onMainWindowUnload({ window }) {
	const handle = itemPaneWindows.get(window);
	if (!handle) return;
	handle.destroy();
	itemPaneWindows.delete(window);
}

/* --- plugin lifecycle ---------------------------------------------------- */

async function startup({ id, rootURI: uri }) {
	rootURI = uri;

	// getResourceAsync, not getContentsFromURLAsync: rootURI is a jar: URL when
	// the plugin is installed packed, and only the channel-based reader handles it.
	contentScript = await Zotero.File.getResourceAsync(rootURI + "build/content-script.js");
	katexScript = await Zotero.File.getResourceAsync(rootURI + "vendor/katex.min.js");
	defaultSnippets = await Zotero.File.getResourceAsync(rootURI + "src/default_snippets.js");
	defaultSnippetVariables = await Zotero.File.getResourceAsync(rootURI + "src/default_snippet_variables.js");

	// The prefs pane reads these instead of duplicating them.
	Zotero.LatexSnippets = { PREF, FIELDS, defaultSnippets, defaultSnippetVariables };

	Zotero.PreferencePanes.register({
		pluginID: id,
		src: rootURI + "prefs.xhtml",
		scripts: [rootURI + "prefs.js"],
		stylesheets: [rootURI + "prefs.css"],
		label: "LaTeX Snippets",
	}).then(
		(paneID) => { prefPane = paneID; },
		(e) => Zotero.debug("LaTeX Snippets: prefs pane failed to register - " + e),
	);

	prefObserver = Zotero.Prefs.registerObserver(PREF, onSettingsChanged, true);

	// New note editors, as they open. registerEditorInstance runs at the top of
	// EditorInstance.init, before _iframeWindow is assigned, so look again on
	// the next tick.
	origRegisterEditorInstance = Zotero.Notes.registerEditorInstance;
	Zotero.Notes.registerEditorInstance = function (instance) {
		const result = origRegisterEditorInstance.apply(this, arguments);
		Zotero.Promise.delay(0).then(() => {
			try { attach(instance); } catch (e) { Zotero.debug("LaTeX Snippets: " + e); }
		});
		return result;
	};

	// Readers, as they open. renderToolbar fires once per reader; the sweep below
	// catches the ones that were already open when the plugin loaded.
	onReaderEvent = (event) => {
		try { attachReader(event.reader); } catch (e) { Zotero.debug("LaTeX Snippets: " + e); }
	};
	Zotero.Reader.registerEventListener("renderToolbar", onReaderEvent, id);

	for (const instance of Zotero.Notes._editorInstances || []) {
		try { attach(instance); } catch (e) { Zotero.debug("LaTeX Snippets: " + e); }
	}
	for (const reader of Zotero.Reader._readers || []) {
		try { attachReader(reader); } catch (e) { Zotero.debug("LaTeX Snippets: " + e); }
	}
	for (const window of Zotero.getMainWindows()) onMainWindowLoad({ window });
}

function shutdown() {
	if (origRegisterEditorInstance) Zotero.Notes.registerEditorInstance = origRegisterEditorInstance;
	origRegisterEditorInstance = null;

	if (onReaderEvent && Zotero.Reader.unregisterEventListener) {
		Zotero.Reader.unregisterEventListener("renderToolbar", onReaderEvent);
	}
	onReaderEvent = null;

	eachTarget((win) => {
		const content = win.wrappedJSObject;
		if (content.__latexSnippetsUninstall) content.__latexSnippetsUninstall();
	});

	for (const handle of itemPaneWindows.values()) handle.destroy();
	itemPaneWindows.clear();

	if (prefObserver) Zotero.Prefs.unregisterObserver(prefObserver);
	prefObserver = null;
	if (prefPane) Zotero.PreferencePanes.unregister(prefPane);
	prefPane = null;
	delete Zotero.LatexSnippets;
	contentScript = null;
	katexScript = null;
}

function install() {}
function uninstall() {}

// node-only: lets test.js check the defaults against src/settings/settings.ts.
if (typeof module !== "undefined") module.exports = { FIELDS, PREF };
