/* Ported from obsidian-latex-suite (src/snippets/parse.ts).
 *
 * The snippet *format* is unchanged — same keys, same option letters, same
 * `${VARIABLE}` substitution, same `export default [...]` file shape. Two things
 * differ: valibot's schemas are hand-written checks (no runtime deps inside the
 * note editor), and the module is evaluated with `new Function` rather than a
 * blob `import()`, which keeps it synchronous and avoids relying on blob URLs
 * inside a resource:// document.
 */
import { RegexSnippet, serializeSnippetLike, Snippet, StringSnippet, VISUAL_SNIPPET_MAGIC_SELECTION_PLACEHOLDER, VisualSnippet } from "./snippets";
import { Options } from "./options";
import { sortSnippets } from "./sort";
import { EXCLUSIONS } from "./environment";
import { api } from "./luasnip_api";
import { ArrayNode, BaseNode, SnippetStringNode, SnippetTabstopOnlyNode, VisualSnippetNode } from "./luasnip_api/node";
import { MacroArea, normalizeMacroAreas } from "src/utils/default_text_areas";

export type SnippetVariables = Record<string, string>;

/**
 * Evaluate a snippets/variables module. Accepts `export default <expr>`, as the
 * docs describe, and also a bare array/object literal.
 */
function evaluateModule(source: string, identifier: string, requireFn: (m: string) => unknown): unknown {
	const hasDefault = /(^|[\s;}])export\s+default\s/.test(source);
	const body = hasDefault
		? source.replace(/(^|[\s;}])export\s+default\s/, "$1return ")
		: `return (\n${source}\n);`;
	// eslint-disable-next-line no-new-func -- snippet files are user-authored code, by design
	const fn = new Function("require", `${body}\n//# sourceURL=latex-snippets:${identifier}`);
	return fn(requireFn);
}

const plainRequire = (module: string): unknown => {
	throw new Error(`Cannot require("${module}") from a snippet file`);
};

export function parseSnippetVariables(source: string | string[], identifier: string): SnippetVariables {
	const modules = Array.isArray(source) ? source : [source];
	const merged: Record<string, string> = {};

	for (const [index, text] of modules.entries()) {
		const name = modules.length > 1 ? `${identifier}[${index}]` : identifier;
		const raw = evaluateModule(text, name, plainRequire);
		if (Array.isArray(raw) || typeof raw !== "object" || raw === null) {
			throw new Error(`${name} must export an object of snippet variables`);
		}
		Object.assign(merged, raw);
	}

	const snippetVariables: SnippetVariables = {};
	for (const [variable, value] of Object.entries(merged)) {
		if (variable.startsWith("${")) {
			if (!variable.endsWith("}")) {
				throw new Error(`Invalid snippet variable name '${variable}': starts with '\${' but does not end with '}'.`);
			}
			snippetVariables[variable] = value;
		} else {
			if (variable.endsWith("}")) {
				throw new Error(`Invalid snippet variable name '${variable}': ends with '}' but does not start with '\${'.`);
			}
			snippetVariables["${" + variable + "}"] = value;
		}
	}
	return snippetVariables;
}

/**
 * `source` is one module, or several — a folder of snippet files, which is how
 * upstream's own docs suggest organising a large set. They are concatenated and
 * then sorted as one list, so priority means the same thing across files.
 */
export function parseSnippets(source: string | string[], snippetVariables: SnippetVariables, identifier: string): Snippet[] {
	const parsedApi = api(snippetVariables);
	const requireFn = (module: string) => {
		if (module === "latex-suite" || module === "latex-snippets") return parsedApi;
		return plainRequire(module);
	};

	const modules = Array.isArray(source) ? source : [source];
	const rawSnippets = modules.flatMap((text, index) => {
		const name = modules.length > 1 ? `${identifier}[${index}]` : identifier;
		const value = evaluateModule(text, name, requireFn);
		if (!Array.isArray(value)) throw new Error(`Expected ${name} to export an array of snippets`);
		return value;
	});

	let parsed: Snippet[];
	try {
		parsed = validateRawSnippets(rawSnippets).map((raw) => {
			try {
				return parseSnippet(raw, snippetVariables);
			} catch (err) {
				throw new Error(`${err}\nErroring snippet:\n${serializeSnippetLike(raw)}`);
			}
		});
	} catch (err) {
		throw new Error(`Invalid snippet format: ${err}`);
	}

	return sortSnippets(parsed);
}

/* --- raw snippet IR --- */

type RawSnippet = {
	trigger: string | RegExp;
	triggerAfter?: string | RegExp;
	replacement: string | ArrayNode | ((...args: never[]) => unknown);
	options: string;
	flags: string;
	priority: number;
	description: string;
	triggerKey: string;
	language?: string;
	excludedMacros: MacroArea[];
	excludedEnvironments: string[];
	includedMacros: MacroArea[];
};

function validateRawSnippets(snippets: unknown): RawSnippet[] {
	if (!Array.isArray(snippets)) throw new Error("Expected snippets to be an array");
	return snippets.flat().map((raw) => {
		try {
			return normalizeRawSnippet(raw);
		} catch (err) {
			throw new Error(`${err}\nErroring snippet:\n${serializeSnippetLike(raw)}`);
		}
	});
}

function normalizeRawSnippet(raw: any): RawSnippet {
	if (!raw || typeof raw !== "object") throw new Error("Value does not resemble a snippet");

	if (typeof raw.trigger !== "string" && !(raw.trigger instanceof RegExp)) {
		throw new Error("`trigger` must be a string or a RegExp");
	}
	if (raw.triggerAfter !== undefined && typeof raw.triggerAfter !== "string" && !(raw.triggerAfter instanceof RegExp)) {
		throw new Error("`triggerAfter` must be a string or a RegExp");
	}
	const replacementOk =
		typeof raw.replacement === "string" ||
		typeof raw.replacement === "function" ||
		(Array.isArray(raw.replacement) && raw.replacement.every((n: unknown) => n instanceof BaseNode));
	if (!replacementOk) throw new Error("`replacement` must be a string, a function, or an array of nodes");
	if (typeof raw.options !== "string") throw new Error("`options` must be a string");

	return {
		trigger: raw.trigger,
		triggerAfter: raw.triggerAfter,
		replacement: Array.isArray(raw.replacement) ? new ArrayNode(raw.replacement) : raw.replacement,
		options: raw.options,
		flags: raw.flags ?? "",
		priority: raw.priority ?? 0,
		description: raw.description ?? "no description provided",
		triggerKey: raw.triggerKey ?? "",
		language: raw.language,
		excludedMacros: normalizeMacroAreas(raw.excludedMacros),
		excludedEnvironments: raw.excludedEnvironments ?? [],
		includedMacros: normalizeMacroAreas(raw.includedMacros),
	};
}

function parseSnippet(raw: RawSnippet, snippetVariables: SnippetVariables): Snippet {
	const { replacement: replacementRaw, priority, description, excludedEnvironments, includedMacros } = raw;
	const options = Options.fromSource(raw.options, raw.language);
	const triggerKey = parseKeyName(raw.triggerKey);

	if (options.regex || raw.trigger instanceof RegExp) {
		const replacement =
			typeof replacementRaw === "string"
				? new ArrayNode([new SnippetStringNode(replacementRaw)])
				: (replacementRaw as ArrayNode);

		let triggerStr: string;
		let flags = raw.flags;
		let triggerAfterFlags = flags;

		if (raw.trigger instanceof RegExp) {
			triggerStr = raw.trigger.source;
			flags = `${raw.trigger.flags}${flags}`;
		} else {
			triggerStr = raw.trigger;
		}

		let triggerAfterStr: string | undefined;
		if (raw.triggerAfter instanceof RegExp) {
			triggerAfterStr = raw.triggerAfter.source;
			triggerAfterFlags = `${raw.triggerAfter.flags}${triggerAfterFlags}`;
		} else {
			triggerAfterStr = raw.triggerAfter;
		}

		flags = filterFlags(flags);
		triggerAfterFlags = filterFlags(triggerAfterFlags);

		triggerStr = insertSnippetVariables(triggerStr, snippetVariables);
		triggerAfterStr = triggerAfterStr && insertSnippetVariables(triggerAfterStr, snippetVariables);

		const excludedMacros = [...getExcludedMacros(triggerStr), ...raw.excludedMacros];

		// A trigger given as a RegExp keeps its own constructor, so a drop-in
		// replacement for RegExp (a PCRE implementation, say) still works.
		const TriggerRegExp = raw.trigger instanceof RegExp ? (raw.trigger.constructor as RegExpConstructor) : RegExp;
		const AfterRegExp =
			raw.triggerAfter instanceof RegExp ? (raw.triggerAfter.constructor as RegExpConstructor) : RegExp;

		// Anchor to the cursor: the trigger has to match where the caret is.
		const trigger = new TriggerRegExp(`(?:${triggerStr})$`, flags);
		const triggerAfter = triggerAfterStr ? new AfterRegExp(`^(?:${triggerAfterStr})`, triggerAfterFlags) : undefined;

		options.regex = true;

		return new RegexSnippet({
			trigger, replacement: replacement as any, options, priority, description,
			excludedMacros, triggerKey, triggerAfter, excludedEnvironments, includedMacros,
		});
	}

	const trigger = insertSnippetVariables(raw.trigger as string, snippetVariables);

	let triggerAfter = raw.triggerAfter;
	if (typeof triggerAfter === "string") triggerAfter = insertSnippetVariables(triggerAfter, snippetVariables);
	else if (triggerAfter instanceof RegExp) throw new Error("triggerAfter cannot be a RegExp for non-regex snippets");

	const excludedMacros = [...getExcludedMacros(trigger), ...raw.excludedMacros];

	if (typeof replacementRaw === "string" && replacementRaw.includes(VISUAL_SNIPPET_MAGIC_SELECTION_PLACEHOLDER)) {
		options.visual = true;
	}

	if (options.visual) {
		const replacement =
			typeof replacementRaw === "string" ? new ArrayNode([new VisualSnippetNode(replacementRaw)]) : (replacementRaw as ArrayNode);
		return new VisualSnippet({
			trigger, replacement: replacement as any, options, priority, description,
			excludedEnvironments, excludedMacros, includedMacros, triggerKey,
		});
	}

	const replacement =
		typeof replacementRaw === "string" ? new ArrayNode([new SnippetTabstopOnlyNode(replacementRaw)]) : (replacementRaw as ArrayNode);
	return new StringSnippet({
		trigger, replacement: replacement as any, options, priority, description,
		excludedEnvironments, excludedMacros, includedMacros, triggerKey, triggerAfter,
	});
}

function filterFlags(flags: string): string {
	const validFlags = ["i", "m", "s", "u", "v"];
	return Array.from(new Set(flags.split(""))).filter((f) => validFlags.includes(f)).join("");
}

function insertSnippetVariables(trigger: string, variables: SnippetVariables) {
	for (const [variable, replacement] of Object.entries(variables)) {
		trigger = trigger.replaceAll(variable, replacement);
	}
	return trigger;
}

function getExcludedMacros(trigger: string): MacroArea[] {
	return trigger in EXCLUSIONS ? [...EXCLUSIONS[trigger]] : [];
}

/* --- key names, in CodeMirror's keymap format (`Ctrl-a`, `Mod-Shift-k`) --- */

const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform || navigator.userAgent);

export function parseKeyName(name: string): string {
	if (!name) return "";
	return name.split(/ (?!$)/).map(normalizeKeyName).join(" ");
}

function normalizeKeyName(name: string) {
	const parts = name.split(/-(?!$)/);
	let result = parts[parts.length - 1];
	if (result === "Space") result = " ";
	let alt = false, ctrl = false, shift = false, meta = false;
	for (let i = 0; i < parts.length - 1; ++i) {
		const mod = parts[i];
		if (/^(cmd|meta|m)$/i.test(mod)) meta = true;
		else if (/^a(lt)?$/i.test(mod)) alt = true;
		else if (/^(c|ctrl|control)$/i.test(mod)) ctrl = true;
		else if (/^s(hift)?$/i.test(mod)) shift = true;
		else if (/^mod$/i.test(mod)) { if (isMac) meta = true; else ctrl = true; }
		else throw new Error("Unrecognized modifier name: " + mod);
	}
	if (alt) result = "Alt-" + result;
	if (ctrl) result = "Ctrl-" + result;
	if (meta) result = "Meta-" + result;
	// A shifted printable key already reports as the shifted character
	// ("A", "?"), so only named keys carry an explicit Shift-.
	if (shift && result.length > 1) result = "Shift-" + result;
	return result;
}

/** The same canonical form, built from a real keyboard event. */
export function keyNameFromEvent(event: KeyboardEvent): string {
	let result = event.key === " " ? " " : event.key;
	if (event.altKey) result = "Alt-" + result;
	if (event.ctrlKey) result = "Ctrl-" + result;
	if (event.metaKey) result = "Meta-" + result;
	if (event.shiftKey && result.length > 1) result = "Shift-" + result;
	return result;
}
