/* LaTeX Snippets — a Zotero plugin (bootstrapped, Zotero 7+).
 *
 * A port of the snippets half of obsidian-latex-suite to Zotero's note editor.
 * This file is the chrome side and does three small things:
 *
 *   1. Registers the settings pane.
 *   2. Injects build/content-script.js into every note-editor iframe. The engine
 *      has to run *inside* that window: it drives Zotero's own ProseMirror
 *      instance, and reaching those objects from chrome across Xray wrappers
 *      would be misery.
 *   3. Pushes settings changes through to the editors that are already open.
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

	{ group: "Advanced", key: "wordDelimiters", type: "text",
		default: "., +-\\n\t:;!?\\/{}[]()=~$'\"|`<>*^%#@&",
		label: "Word delimiters", hint: "Used by the \"w\" (word boundary) snippet option." },
	{ group: "Advanced", key: "snippetDebug", type: "select", default: "off",
		options: ["off", "info", "verbose"], label: "Log expansions to the console" },
];

let rootURI = null;
let contentScript = null;
let defaultSnippets = "";
let defaultSnippetVariables = "";
let prefPane = null;
let prefObserver = null;
let origRegisterEditorInstance = null;

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

function inject(win) {
	const doc = win.document;
	if (!doc || !doc.documentElement) return;

	const content = win.wrappedJSObject;
	content.__latexSnippetsSettings = settingsJSON();

	if (content.__latexSnippetsInstalled) {
		if (content.__latexSnippetsReload) content.__latexSnippetsReload(settingsJSON());
		return;
	}

	// A <script> element, not eval from chrome: the engine needs native access
	// to the page's ProseMirror objects, and editor.html is a resource:// page
	// with no CSP (it already runs an inline script of Zotero's own).
	const script = doc.createElement("script");
	script.textContent = contentScript;
	doc.documentElement.appendChild(script);
	script.remove();
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

function eachOpenEditor(fn) {
	for (const instance of Zotero.Notes._editorInstances || []) {
		try {
			if (instance && instance._iframeWindow) fn(instance);
		} catch (e) {
			Zotero.debug("LaTeX Snippets: " + e);
		}
	}
}

function onSettingsChanged() {
	const json = settingsJSON();
	eachOpenEditor((instance) => {
		const content = instance._iframeWindow.wrappedJSObject;
		if (content.__latexSnippetsReload) content.__latexSnippetsReload(json);
	});
}

/* --- plugin lifecycle ---------------------------------------------------- */

async function startup({ id, rootURI: uri }) {
	rootURI = uri;

	// getResourceAsync, not getContentsFromURLAsync: rootURI is a jar: URL when
	// the plugin is installed packed, and only the channel-based reader handles it.
	contentScript = await Zotero.File.getResourceAsync(rootURI + "build/content-script.js");
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

	eachOpenEditor(attach);
}

function shutdown() {
	if (origRegisterEditorInstance) Zotero.Notes.registerEditorInstance = origRegisterEditorInstance;
	origRegisterEditorInstance = null;

	eachOpenEditor((instance) => {
		const content = instance._iframeWindow.wrappedJSObject;
		if (content.__latexSnippetsUninstall) content.__latexSnippetsUninstall();
	});

	if (prefObserver) Zotero.Prefs.unregisterObserver(prefObserver);
	prefObserver = null;
	if (prefPane) Zotero.PreferencePanes.unregister(prefPane);
	prefPane = null;
	delete Zotero.LatexSnippets;
	contentScript = null;
}

function install() {}
function uninstall() {}

// node-only: lets test.js check the defaults against src/settings/settings.ts.
if (typeof module !== "undefined") module.exports = { FIELDS, PREF };
