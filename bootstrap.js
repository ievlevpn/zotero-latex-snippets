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
	{ group: "Snippet files", key: "loadSnippetsFromFile", type: "bool", default: false,
		label: "Load snippets from a file",
		hint: "Point at a .js file, or a folder of them \u2014 an obsidian-latex-suite snippets file works as-is. Re-read whenever it changes on disk." },
	{ group: "Snippet files", key: "snippetsFileLocation", type: "file", default: "",
		label: "Snippets file" },
	{ group: "Snippet files", key: "loadSnippetVariablesFromFile", type: "bool", default: false,
		label: "Load snippet variables from a file" },
	{ group: "Snippet files", key: "snippetVariablesFileLocation", type: "file", default: "",
		label: "Snippet variables file" },

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
let payloadJSON = null;

/* Snippets can come from a file on disk instead of the settings pane — the
 * point being that an obsidian-latex-suite snippets file works unchanged. The
 * engine runs in a content window and cannot read files, so the contents are
 * read here and travel with the settings. */
const SOURCES = [
	{ key: "snippets", enabledKey: "loadSnippetsFromFile", pathKey: "snippetsFileLocation" },
	{ key: "snippetVariables", enabledKey: "loadSnippetVariablesFromFile", pathKey: "snippetVariablesFileLocation" },
];

const fileSources = new Map(); // settings key -> { path, text, stamp, error }
let pollTimer = null;

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
	payloadJSON = null;
}

function fileSourceFor(source) {
	const overrides = readOverrides();
	const enabled = overrides[source.enabledKey] === true;
	const path = (overrides[source.pathKey] || "").trim();
	return enabled && path ? path : null;
}

/** A snippets path is a file, or a folder of them, as upstream's own docs suggest. */
function filesAt(path) {
	const target = Zotero.File.pathToFile(path);
	if (!target.exists()) throw new Error("no such file or folder");
	if (!target.isDirectory()) return [target];

	const children = [];
	const entries = target.directoryEntries;
	while (entries.hasMoreElements()) {
		const entry = entries.getNext().QueryInterface(Components.interfaces.nsIFile);
		if (entry.isFile() && !entry.leafName.startsWith(".")) children.push(entry);
	}
	// By name, so priority ties break the same way on every machine.
	children.sort((a, b) => (a.leafName < b.leafName ? -1 : a.leafName > b.leafName ? 1 : 0));
	return children;
}

/** Names and mtimes together, so adding or removing a file counts as a change. */
const stampOf = (files) => files.map((f) => f.leafName + ":" + f.lastModifiedTime).join("|");

/** Read a path into what the engine wants: one source, or one per file. */
async function readSourceAt(path) {
	const files = filesAt(path);
	if (!files.length) throw new Error("folder contains no files");
	const sources = await Promise.all(files.map((f) => Zotero.File.getContentsAsync(f.path, "utf-8")));
	return { sources, files, stamp: stampOf(files) };
}

/**
 * Re-read whichever sources come from disk. Returns true if anything changed,
 * so callers know whether the open editors need telling.
 */
async function refreshFileSources() {
	let changed = false;

	for (const source of SOURCES) {
		const path = fileSourceFor(source);
		if (!path) {
			if (fileSources.delete(source.key)) changed = true;
			continue;
		}

		const previous = fileSources.get(source.key);
		let stamp;
		try {
			// nsIFile rather than IOUtils: confirmed present in this scope, and a
			// stat is cheap enough not to be worth an async round trip.
			stamp = stampOf(filesAt(path));
		} catch (e) {
			// Missing or unreadable: keep the last good copy rather than dropping
			// the user's snippets because a vault happens to be offline.
			if (previous && previous.error) continue;
			fileSources.set(source.key, { path, text: previous?.text ?? null, stamp: null, error: String(e) });
			Zotero.debug("LaTeX Snippets: cannot read " + path + " - " + e);
			changed = true;
			continue;
		}

		if (previous && previous.path === path && previous.stamp === stamp && !previous.error) continue;

		try {
			const { sources } = await readSourceAt(path);
			fileSources.set(source.key, { path, text: sources.length === 1 ? sources[0] : sources, stamp, error: null });
			changed = true;
		} catch (e) {
			fileSources.set(source.key, { path, text: previous?.text ?? null, stamp: null, error: String(e) });
			Zotero.debug("LaTeX Snippets: cannot read " + path + " - " + e);
			changed = true;
		}
	}

	if (changed) payloadJSON = null;
	return changed;
}

/** Poll for edits to those files, but only while at least one is in use. */
function syncFilePolling() {
	const wanted = SOURCES.some((source) => fileSourceFor(source));
	if (wanted === !!pollTimer) return;

	if (!wanted) {
		clearInterval(pollTimer);
		pollTimer = null;
		return;
	}
	// A stat every few seconds is nothing, and it means editing snippets in your
	// own editor shows up in Zotero without a round trip through settings.
	pollTimer = setInterval(async () => {
		try {
			if (await refreshFileSources()) pushSettings();
		} catch (e) {
			Zotero.debug("LaTeX Snippets: " + e);
		}
	}, 3000);
}

/**
 * What travels to the engine: the overrides, plus any source read from disk.
 *
 * Only the overrides are sent, not a full settings object, so a field the user
 * never touched keeps following the shipped default.
 */
function settingsJSON() {
	if (payloadJSON) return payloadJSON;

	readOverrides();
	if (fileSources.size === 0) {
		payloadJSON = overridesJSON; // already exactly this JSON; don't re-serialise
		return payloadJSON;
	}

	const payload = { ...overridesCache };
	for (const [key, source] of fileSources) {
		if (source.text !== null) payload[key] = source.text;
	}
	payloadJSON = JSON.stringify(payload);
	return payloadJSON;
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
 * their equations itself. Read it only if annotation rendering is switched on,
 * and inject it only into readers. */
async function ensureKatexScript() {
	if (katexScript !== null || !mathEnabled()) return katexScript;
	try {
		katexScript = await Zotero.File.getResourceAsync(rootURI + "vendor/katex.min.js");
	} catch (e) {
		Zotero.debug("LaTeX Snippets: could not read KaTeX - " + e);
	}
	return katexScript;
}

function ensureKatex(win) {
	const content = win.wrappedJSObject;
	if (content.katex || !katexScript || !mathEnabled()) return false;
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

/** Hand the current settings to every editor that is already open. */
function pushSettings() {
	const json = settingsJSON();
	eachTarget((win) => {
		const content = win.wrappedJSObject;
		if (content.__latexSnippetsReload) content.__latexSnippetsReload(json);
	});
	eachItemPane((handle) => handle.refresh());
}

async function onSettingsChanged() {
	forgetOverrides();

	// A reader that started with rendering off has no KaTeX yet; give it one
	// before telling the engine to look again.
	await ensureKatexScript();
	for (const reader of Zotero.Reader._readers || []) {
		try {
			if (reader?._iframeWindow) ensureKatex(reader._iframeWindow);
		} catch (e) {
			Zotero.debug("LaTeX Snippets: " + e);
		}
	}

	syncFilePolling();
	await refreshFileSources();
	pushSettings();
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
	observer.observe(root, { childList: true, subtree: true });
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
	try {
		contentScript = await Zotero.File.getResourceAsync(rootURI + "build/content-script.js");
		defaultSnippets = await Zotero.File.getResourceAsync(rootURI + "src/default_snippets.js");
		defaultSnippetVariables = await Zotero.File.getResourceAsync(rootURI + "src/default_snippet_variables.js");
	} catch (e) {
		// Without these there is nothing to inject; say so rather than failing
		// silently and leaving no settings pane either.
		Zotero.logError(new Error("LaTeX Snippets: could not read its own files - " + e));
		return;
	}
	await ensureKatexScript();

	syncFilePolling();
	await refreshFileSources();

	// The prefs pane reads these instead of duplicating them.
	Zotero.LatexSnippets = {
		PREF,
		FIELDS,
		defaultSnippets,
		defaultSnippetVariables,
		/** What each file-backed source is doing right now, for the settings pane. */
		fileStatus: (key) => fileSources.get(key) ?? null,
		readSourceAt,
		reloadFiles: async () => {
			await refreshFileSources();
			pushSettings();
		},
	};

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

/* Shutdown runs during an upgrade, and every step of it touches something that
 * can be in an awkward state — a window mid-close, a pane already unregistered.
 * One throw must not stop the rest from being undone. */
function safely(what, fn) {
	try {
		fn();
	} catch (e) {
		Zotero.debug("LaTeX Snippets: " + what + " failed during shutdown - " + e);
	}
}

function shutdown() {
	safely("restoring registerEditorInstance", () => {
		if (origRegisterEditorInstance) Zotero.Notes.registerEditorInstance = origRegisterEditorInstance;
	});
	origRegisterEditorInstance = null;

	safely("unregistering the reader listener", () => {
		if (onReaderEvent && Zotero.Reader.unregisterEventListener) {
			Zotero.Reader.unregisterEventListener("renderToolbar", onReaderEvent);
		}
	});
	onReaderEvent = null;

	safely("uninstalling from editors", () => {
		eachTarget((win) => {
			const content = win.wrappedJSObject;
			if (content.__latexSnippetsUninstall) content.__latexSnippetsUninstall();
		});
	});

	safely("tearing down item panes", () => {
		eachItemPane((handle, window) => {
			try {
				handle.destroy();
			} finally {
				itemPaneWindows.delete(window);
			}
		});
	});

	safely("stopping the file poll", () => {
		if (pollTimer) clearInterval(pollTimer);
	});
	pollTimer = null;
	fileSources.clear();

	safely("unregistering the pref observer", () => {
		if (prefObserver) Zotero.Prefs.unregisterObserver(prefObserver);
	});
	prefObserver = null;
	safely("unregistering the prefs pane", () => {
		if (prefPane) Zotero.PreferencePanes.unregister(prefPane);
	});
	prefPane = null;

	safely("clearing globals", () => {
		delete Zotero.LatexSnippets;
		forgetOverrides();
	});
	contentScript = null;
	katexScript = null;
}

function install() {}
function uninstall() {}

// node-only: lets test.js check the defaults against src/settings/settings.ts.
if (typeof module !== "undefined") module.exports = { FIELDS, PREF };
