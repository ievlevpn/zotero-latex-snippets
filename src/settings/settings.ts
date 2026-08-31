/* Settings, ported from obsidian-latex-suite (src/settings/settings.ts).
 *
 * Trimmed to what exists here: conceal, inline math preview and bracket
 * colouring are Zotero's job (it renders equations with KaTeX as you type), and
 * vim/IME/i18n have no counterpart. Everything that shapes snippet behaviour is
 * kept, with the same names and defaults.
 */
import { Snippet } from "src/snippets/snippets";
import { Environment } from "src/snippets/environment";
import { parseSnippets, parseSnippetVariables } from "src/snippets/parse";
import DEFAULT_SNIPPETS_SOURCE from "../default_snippets.js?raw";
import DEFAULT_SNIPPET_VARIABLES_SOURCE from "../default_snippet_variables.js?raw";

export type SnippetDebugLevel = "off" | "info" | "verbose";

export interface RawSettings {
	/** JavaScript source: `export default [ … ]` */
	snippets: string;
	/** JavaScript source: `export default { … }` */
	snippetVariables: string;

	snippetsEnabled: boolean;
	snippetsTrigger: string;
	snippetNextTabstopTrigger: string;
	snippetPreviousTabstopTrigger: string;
	removeSnippetWhitespace: boolean;
	wordDelimiters: string;
	snippetRecursion: number;
	snippetDebug: SnippetDebugLevel;

	autofractionEnabled: boolean;
	autofractionSymbol: string;
	autofractionBreakingChars: string;
	autofractionTrigger: string;
	autofractionExcludedEnvs: string;

	matrixShortcutsEnabled: boolean;
	matrixShortcutsEnvNames: string;
	matrixShortcutsMacroNames: string;
	matrixShortcutsCellTrigger: string;
	matrixShortcutsNewlineTrigger: string;
	matrixShortcutsExitTrigger: string;

	taboutEnabled: boolean;
	taboutTrigger: string;
	taboutExitEquationOnlyOnEOL: boolean;
	taboutClosingSymbols: string;

	autoEnlargeBrackets: boolean;
	autoEnlargeBracketsSpace: boolean;
	autoEnlargeBracketsTriggers: string;

	annotationSnippetsEnabled: boolean;
	annotationMathEnabled: boolean;
}

export type Settings = Omit<
	RawSettings,
	"snippets" | "snippetVariables" | "autofractionExcludedEnvs" | "matrixShortcutsEnvNames" | "matrixShortcutsMacroNames" | "taboutClosingSymbols" | "autoEnlargeBracketsTriggers"
> & {
	snippets: Snippet[];
	autofractionExcludedEnvs: Environment[];
	matrixShortcutsEnvNames: string[];
	matrixShortcutsMacroNames: string[];
	taboutClosingSymbols: Set<string>;
	autoEnlargeBracketsTriggers: string[];
};

export const DEFAULT_SNIPPETS = DEFAULT_SNIPPETS_SOURCE;
export const DEFAULT_SNIPPET_VARIABLES = DEFAULT_SNIPPET_VARIABLES_SOURCE;

export const DEFAULT_SETTINGS: RawSettings = {
	snippets: DEFAULT_SNIPPETS,
	snippetVariables: DEFAULT_SNIPPET_VARIABLES,

	snippetsEnabled: true,
	snippetsTrigger: "Tab",
	snippetNextTabstopTrigger: "Tab",
	snippetPreviousTabstopTrigger: "Shift-Tab",
	removeSnippetWhitespace: true,
	wordDelimiters: "., +-\\n\t:;!?\\/{}[]()=~$'\"|`<>*^%#@&",
	snippetRecursion: 0,
	snippetDebug: "off",

	autofractionEnabled: true,
	autofractionSymbol: "\\frac",
	autofractionBreakingChars: "+-=\t",
	autofractionTrigger: "/",
	autofractionExcludedEnvs: `[
		["^{", "}"],
		["\\\\pu{", "}"]
	]`,

	matrixShortcutsEnabled: true,
	matrixShortcutsEnvNames: "pmatrix, cases, align, gather, bmatrix, Bmatrix, vmatrix, Vmatrix, array, matrix",
	matrixShortcutsMacroNames: "eqalign",
	matrixShortcutsCellTrigger: "Tab",
	matrixShortcutsNewlineTrigger: "Enter",
	matrixShortcutsExitTrigger: "Shift-Enter",

	taboutEnabled: true,
	taboutTrigger: "Tab",
	taboutExitEquationOnlyOnEOL: true,
	taboutClosingSymbols: "), ], \\rbrack, \\}, \\rbrace, \\rangle, \\rvert, \\rVert, \\rfloor, \\rceil, \\urcorner, }",

	autoEnlargeBrackets: true,
	autoEnlargeBracketsSpace: true,
	autoEnlargeBracketsTriggers: "sum, int, frac, prod, bigcup, bigcap",

	annotationSnippetsEnabled: true,
	annotationMathEnabled: true,
};

function strToArray(str: string) {
	return str.replace(/\s/g, "").split(",").filter(Boolean);
}

function parseExcludedEnvs(envsStr: string): Environment[] {
	try {
		const parsed = JSON.parse(envsStr);
		if (!Array.isArray(parsed)) throw new Error("expected an array of [open, close] pairs");
		return parsed.map(([openSymbol, closeSymbol]) => {
			if (typeof openSymbol !== "string" || typeof closeSymbol !== "string") {
				throw new Error("every item needs to be an array of two strings");
			}
			return { openSymbol, closeSymbol };
		});
	} catch (e) {
		console.error("latex-snippets: bad autofractionExcludedEnvs -", e);
		return [];
	}
}

/** Compile the stored strings into the shape the engine runs against. */
export function processSettings(raw: RawSettings): Settings {
	const snippetVariables = parseSnippetVariables(raw.snippetVariables, "snippet-variables");
	const snippets = parseSnippets(raw.snippets, snippetVariables, "snippets");

	return {
		...raw,
		snippets,
		autofractionExcludedEnvs: parseExcludedEnvs(raw.autofractionExcludedEnvs),
		matrixShortcutsEnvNames: strToArray(raw.matrixShortcutsEnvNames),
		matrixShortcutsMacroNames: strToArray(raw.matrixShortcutsMacroNames),
		taboutClosingSymbols: new Set(strToArray(raw.taboutClosingSymbols)),
		// LaTeX commands in the trigger list are written without their backslash
		autoEnlargeBracketsTriggers: strToArray(raw.autoEnlargeBracketsTriggers).map((t) =>
			/[A-Za-z]+/.test(t) ? `\\${t}` : t,
		),
	};
}
