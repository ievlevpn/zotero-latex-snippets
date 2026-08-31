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

/* The pref holds the whole snippet source, tens of kilobytes of it, so parsing
 * it is not something to do casually. Cached until the pref changes. */
let overridesCache = null;
let overridesJSON = null;

function readOverrides() {
	if (overridesCache) return overridesCache;
	overridesJSON = Zotero.Prefs.get(PREF, true) || "{}";
	try {
		const parsed = JSON.parse(overridesJSON);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			overridesCache = parsed;
		} else {
			overridesCache = {};
			overridesJSON = "{}"; // the string is handed straight to the engine
		}
	} catch (e) {
		Zotero.debug("LaTeX Snippets: unreadable settings pref - " + e);
		overridesCache = {};
		overridesJSON = "{}";
	}
	return overridesCache;
}

function forgetOverrides() {
	overridesCache = null;
	overridesJSON = null;
}

// Only the overrides travel; the content script merges them over its own
// defaults, so an unset field always follows the shipped default. The stored
// pref is already this exact JSON, so hand it over rather than re-serialising.
function settingsJSON() {
	readOverrides();
	return overridesJSON;
}

function mathEnabled() {
	return readOverrides().annotationMathEnabled !== false;
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

	if (withKatex) ensureKatex(win);
	runScript(doc, contentScript);
}

/* KaTeX is a quarter of a megabyte, and notes never need it — Zotero renders
 * their equations itself. Load it only into readers, and only when annotation
 * rendering is actually switched on. */
function ensureKatex(win) {
	const content = win.wrappedJSObject;
	if (content.katex || !mathEnabled()) return false;
	runScript(win.document, katexScript);
	return true;
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
	forgetOverrides();
	const json = settingsJSON();

	// A reader that started with rendering off has no KaTeX yet; give it one
	// before telling the engine to look again.
	for (const reader of Zotero.Reader._readers || []) {
		try {
			if (reader?._iframeWindow) ensureKatex(reader._iframeWindow);
		} catch (e) {
			Zotero.debug("LaTeX Snippets: " + e);
		}
	}

	eachTarget((win) => {
		const content = win.wrappedJSObject;
		if (content.__latexSnippetsReload) content.__latexSnippetsReload(json);
	});
	eachItemPane((handle) => handle.refresh());
}

/* --- the item pane's annotation rows ------------------------------------- */

/* Those rows are chrome, not reader content, so the injected bundle cannot see
 * them. They are read-only, which makes this the easy half: render and leave it
 * alone — there is no editing to put the `$…$` back for. */
/* Keyed weakly, and iterated through Zotero's own window list, so a window that
 * closes without us hearing about it is not pinned in memory by this. */
const itemPaneWindows = new WeakMap();

function eachItemPane(fn) {
	for (const window of Zotero.getMainWindows()) {
		const handle = itemPaneWindows.get(window);
		if (handle) fn(handle, window);
	}
}

const ROW_SELECTOR = "annotation-row .comment";

function installItemPaneRendering(window) {
	const doc = window.document;
	const root = doc.getElementById("zotero-item-pane") || doc.documentElement;
	if (!root) return null;

	// Half a megabyte of scripts, loaded the first time an annotation with a
	// comment actually shows up rather than on every window that opens.
	let loaded = false;
	const load = () => {
		if (loaded) return true;
		try {
			Services.scriptloader.loadSubScript(rootURI + "vendor/katex.min.js", window);
			Services.scriptloader.loadSubScript(rootURI + "build/render.js", window);
			loaded = !!(window.LatexSnippetsRender && window.katex);
		} catch (e) {
			Zotero.debug("LaTeX Snippets: renderer failed to load in the item pane - " + e);
			loaded = false;
		}
		return loaded;
	};

	let scheduled = 0;

	const tick = () => {
		scheduled = 0;
		const rows = doc.querySelectorAll(ROW_SELECTOR);
		if (!rows.length) return;
		if (mathEnabled()) {
			if (!load()) return;
			// syncRender, not renderMath: it does nothing when the DOM already
			// matches, which is what keeps this off the observer's treadmill.
			for (const el of rows) window.LatexSnippetsRender.syncRender(el, window.katex);
		} else if (loaded) {
			for (const el of rows) {
				window.LatexSnippetsRender.unrenderMath(el);
				window.LatexSnippetsRender.clearRenderState(el);
			}
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
			if (!loaded) return;
			for (const el of doc.querySelectorAll(ROW_SELECTOR)) {
				window.LatexSnippetsRender.unrenderMath(el);
				window.LatexSnippetsRender.clearRenderState(el);
			}
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

	eachItemPane((handle, window) => {
		handle.destroy();
		itemPaneWindows.delete(window);
	});

	if (prefObserver) Zotero.Prefs.unregisterObserver(prefObserver);
	prefObserver = null;
	if (prefPane) Zotero.PreferencePanes.unregister(prefPane);
	prefPane = null;
	delete Zotero.LatexSnippets;
	forgetOverrides();
	contentScript = null;
	katexScript = null;
}

function install() {}
function uninstall() {}

// node-only: lets test.js check the defaults against src/settings/settings.ts.
if (typeof module !== "undefined") module.exports = { FIELDS, PREF };
