/* Entry point. This bundle is injected into each note-editor iframe by
 * bootstrap.js; from there it drives Zotero's own ProseMirror instance.
 *
 * The keymap order mirrors DOCS.md#keymap-order, minus the entries that have no
 * counterpart in Zotero (auto-deleting `$`, which is not text here, and vim).
 */
import { currentBuffer, isReaderWindow } from "./editor/index";
import { rememberSelectionClass, getEditorCore } from "./editor/pm";
import { keyNameFromEvent } from "./snippets/parse";
import { DEFAULT_SETTINGS, processSettings, RawSettings, Settings } from "./settings/settings";
import { runSnippets } from "./features/run_snippets";
import { runAutoFraction } from "./features/autofraction";
import { shouldTaboutByCloseBracket, tabout } from "./features/tabout";
import { addCellMatrixShortcut, exitMatrixShortcut, newlineMatrixShortcut, priorityTaboutMatrixShortcut } from "./features/matrix_shortcuts";
import { clearTabstops, setSelectionToNextTabstop } from "./snippets/snippet_management";
import { Snippet } from "./snippets/snippets";
import { Context } from "./utils/context";
import { installAnnotationRendering } from "./reader/annotations";

declare const window: any;

const FLAG = "__latexSnippetsInstalled";

let settings: Settings | null = null;
let automaticSnippets: Snippet[] = [];

/* Last few keystrokes we acted on, for diagnosing misbehaviour in a real note:
 * read `window.__latexSnippets.recent` from the note editor. Cheap enough to
 * always keep. */
type Trace = { key: string; before: string; from: number; to: number; after?: string; handled: boolean };
const recent: Trace[] = [];
let trace: Trace | null = null;
const currentTrace = () => trace;

function loadSettings(json: string | undefined) {
	let raw: RawSettings = DEFAULT_SETTINGS;
	try {
		if (json) raw = { ...DEFAULT_SETTINGS, ...JSON.parse(json) };
	} catch (e) {
		console.error("latex-snippets: unreadable settings, using defaults -", e);
	}

	try {
		settings = processSettings(raw);
	} catch (e) {
		console.error("latex-snippets: could not parse snippets -", e);
		// Fall back to the defaults rather than leaving the editor with none.
		try {
			settings = processSettings(DEFAULT_SETTINGS);
		} catch {
			settings = null;
		}
	}

	automaticSnippets = settings ? settings.snippets.filter((s) => s.options.automatic) : [];
	clearTabstops();
	syncAnnotationRendering();
}

/* Rendering is only ever installed in a reader window, and only while it is
 * switched on: turning it off has to put every `$…$` back. */
let stopRendering: (() => void) | null = null;

function syncAnnotationRendering() {
	const wanted = !!settings?.annotationMathEnabled && isReaderWindow(window);
	if (wanted === !!stopRendering) return;
	if (wanted) stopRendering = installAnnotationRendering(window);
	else { stopRendering?.(); stopRendering = null; }
}

/** Snippets bound to this key: an explicit `triggerKey`, or the default trigger. */
function manualSnippetsFor(key: string): Snippet[] {
	if (!settings) return [];
	return settings.snippets.filter(
		(s) => s.triggerKey === key || (!s.triggerKey && !s.options.automatic && key === settings!.snippetsTrigger),
	);
}

function handleKeydown(event: KeyboardEvent): boolean {
	if (!settings) return false;
	// Don't fire mid-composition: an IME's first keydown reports keyCode 229 and
	// neither `isComposing` nor `event.key` is meaningful yet.
	if (event.isComposing || (event as any).keyCode === 229) return false;

	const core = getEditorCore(window);
	if (core?.view) rememberSelectionClass(core.view);

	const buffer = currentBuffer(window);
	if (!buffer) return false;
	if (isReaderWindow(window) && !settings.annotationSnippetsEnabled) return false;

	const key = keyNameFromEvent(event);

	trace = { key, before: buffer.text, from: buffer.from, to: buffer.to, handled: false };
	recent.push(trace);
	if (recent.length > 20) recent.shift();

	// 1. Automatic snippets, on any plain printable key.
	if (settings.snippetsEnabled && event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
		if (runSnippets(window, { snippets: automaticSnippets, key: event.key }, settings)) return true;
	}

	// 2. Manual snippets (Tab by default, or the snippet's own triggerKey).
	if (settings.snippetsEnabled) {
		const manual = manualSnippetsFor(key);
		if (manual.length && runSnippets(window, { snippets: manual }, settings)) return true;
	}

	// 3./4. Tabstops.
	if (key === settings.snippetNextTabstopTrigger && setSelectionToNextTabstop(buffer, false)) return true;
	if (key === settings.snippetPreviousTabstopTrigger && setSelectionToNextTabstop(buffer, true)) return true;

	// 5. Auto-fraction.
	if (settings.autofractionEnabled && key === settings.autofractionTrigger) {
		if (runAutoFraction(window, settings)) return true;
	}

	// 6.-9. Matrix shortcuts. Tabout inside brackets wins over adding a cell.
	if (settings.matrixShortcutsEnabled) {
		if (
			settings.taboutEnabled &&
			settings.taboutTrigger === settings.matrixShortcutsCellTrigger &&
			key === settings.taboutTrigger &&
			priorityTaboutMatrixShortcut(window, settings)
		) {
			return true;
		}
		if (key === settings.matrixShortcutsNewlineTrigger && newlineMatrixShortcut(window, settings)) return true;
		if (key === settings.matrixShortcutsCellTrigger && addCellMatrixShortcut(window, settings)) return true;
		if (key === settings.matrixShortcutsExitTrigger && exitMatrixShortcut(window, settings)) return true;
	}

	// 10./11. Tabout.
	if (settings.taboutEnabled) {
		if (key === settings.taboutTrigger && tabout(window, settings)) return true;
		if ([")", "}", "]"].includes(key) && shouldTaboutByCloseBracket(window, key) && tabout(window, settings)) {
			return true;
		}
	}

	return false;
}

function install() {
	if (window[FLAG]) {
		// Re-injected (settings changed): just take the new ones.
		loadSettings(window.__latexSnippetsSettings);
		return;
	}
	window[FLAG] = true;

	loadSettings(window.__latexSnippetsSettings);

	// Set when we handled a printable key, so the insertion it would otherwise
	// have caused can be cancelled again at `beforeinput`. Belt and braces:
	// preventDefault on the keydown should already be enough, and when it is this
	// never fires, because a cancelled keydown produces no beforeinput.
	let handledPrintable = false;

	const onKeydown = (event: KeyboardEvent) => {
		handledPrintable = false;
		trace = null;
		try {
			if (handleKeydown(event)) {
				event.preventDefault();
				event.stopPropagation();
				handledPrintable = event.key.length === 1;
				const entry = currentTrace();
				if (entry) {
					entry.handled = true;
					entry.after = currentBuffer(window)?.text;
				}
			}
		} catch (e) {
			console.error("latex-snippets:", e);
			clearTabstops();
		}
	};

	const onBeforeInput = (event: InputEvent) => {
		if (!handledPrintable) return;
		handledPrintable = false;
		if (event.inputType === "insertText" || event.inputType === "insertCompositionText") {
			event.preventDefault();
			event.stopPropagation();
		}
	};

	// Capture phase on the document: ProseMirror listens on its own editable
	// element, so this runs first for both the note and any nested equation.
	window.document.addEventListener("keydown", onKeydown, true);
	window.document.addEventListener("beforeinput", onBeforeInput, true);

	// Called from bootstrap.js when the plugin is disabled or updated.
	window.__latexSnippetsUninstall = () => {
		window.document.removeEventListener("keydown", onKeydown, true);
		window.document.removeEventListener("beforeinput", onBeforeInput, true);
		clearTabstops();
		stopRendering?.();
		stopRendering = null;
		settings = null;
		delete window[FLAG];
		delete window.__latexSnippetsReload;
		delete window.__latexSnippetsUninstall;
		delete window.__latexSnippets;
	};

	// Let the chrome side push new settings without reloading the note.
	window.__latexSnippetsReload = (json: string) => loadSettings(json);

	// Handy from the note editor's console.
	window.__latexSnippets = {
		get settings() { return settings; },
		get recent() { return recent; },
		context: () => {
			const buffer = currentBuffer(window);
			return buffer ? Context.fromBuffer(buffer) : null;
		},
	};
}

install();
