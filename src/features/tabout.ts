/* Ported from obsidian-latex-suite (src/features/tabout.ts).
 *
 * Token scanning is unchanged. "Leave the equation" is simpler here: instead of
 * hunting for the closing `$$` and the line after it, we step out of the math
 * node (see `exitMath`).
 */
import { currentBuffer, exitMath } from "src/editor/pm";
import { intersection } from "src/utils/editor_utils";
import { Context } from "src/utils/context";
import { Settings } from "src/settings/settings";
import { Token, tokenize } from "src/utils/tokenizer";

const LEFT_COMMANDS = new Set(["\\left", "\\bigl", "\\Bigl", "\\biggl", "\\Biggl"]);
const RIGHT_COMMANDS = new Set(["\\right", "\\bigr", "\\Bigr", "\\biggr", "\\Biggr"]);
const DELIMITERS = new Set([
	"(", ")",
	"[", "]", "\\lbrack", "\\rbrack",
	"\\{", "\\}", "\\lbrace", "\\rbrace",
	"<", ">", "\\langle", "\\rangle", "\\lt", "\\gt",
	"|", "\\vert", "\\lvert", "\\rvert",
	"\\|", "\\Vert", "\\lVert", "\\rVert",
	"\\lfloor", "\\rfloor",
	"\\lceil", "\\rceil",
	"\\ulcorner", "\\urcorner",
	"/", "\\\\", "\\backslash",
	"\\uparrow", "\\downarrow",
	"\\Uparrow", "\\Downarrow",
	".",
]);
const DELIMITERS_MAP: Record<string, string> = {
	"(": ")",
	"[": "]",
	"{": "}",
	"\\lbrack": "\\rbrack",
	"\\lbrace": "\\rbrace",
	"\\langle": "\\rangle",
	"\\lvert": "\\rvert",
	"\\lVert": "\\rVert",
	"\\lfloor": "\\rfloor",
	"\\lceil": "\\rceil",
	"\\ulcorner": "\\urcorner",
	"<": ">",
};

const isClosingDelimiterToken = (tokens: Token[], index: number, closingSymbols: Set<string>): boolean => {
	const current = tokens[index];
	if (index > 0) {
		const prev = tokens[index - 1];
		if (RIGHT_COMMANDS.has(prev.text) && DELIMITERS.has(current.text)) return true;
		if (LEFT_COMMANDS.has(prev.text) && DELIMITERS.has(current.text)) return false;
	}
	return closingSymbols.has(current.text);
};

const isUnmatchedRightCommand = (tokens: Token[], index: number): boolean => {
	if (!RIGHT_COMMANDS.has(tokens[index].text)) return false;
	if (index + 1 >= tokens.length) return true;
	return !DELIMITERS.has(tokens[index + 1].text);
};

export function tabout(win: any, settings: Settings): boolean {
	const buffer = currentBuffer(win);
	if (!buffer || !buffer.inMath) return false;
	if (buffer.from !== buffer.to) return false;

	const ctx = Context.fromBuffer(buffer);
	const bounds = ctx.getBounds();
	if (!bounds) return false;

	const cursor = buffer.to;
	const tokens = tokenize(buffer.text.slice(bounds.inner_start, bounds.inner_end));
	const relative = cursor - bounds.inner_start;

	const found = tokens.findIndex((token) => token.end > relative);
	for (let i = found === -1 ? tokens.length : found; i < tokens.length; i++) {
		// Normal navigation, and error recovery: an unmatched \right is exactly
		// where the user needs to be to type the delimiter they forgot.
		if (isClosingDelimiterToken(tokens, i, settings.taboutClosingSymbols) || isUnmatchedRightCommand(tokens, i)) {
			buffer.setSelection(bounds.inner_start + tokens[i].end);
			return true;
		}
	}

	const isAtEnd = buffer.text.slice(cursor, bounds.inner_end).trim().length === 0;
	if (!isAtEnd && settings.taboutExitEquationOnlyOnEOL) return false;

	return exitMath(win);
}

/** The end of the first unmatched closing delimiter after the cursor, or null. */
export function taboutByEnclosedBrackets(latexString: string, closingSymbols: Set<string>): number | null {
	const tokens = tokenize(latexString);
	const closing = intersection(new Set(Object.values(DELIMITERS_MAP)), closingSymbols);
	const opening = new Set(Object.keys(DELIMITERS_MAP).filter((key) => closing.has(DELIMITERS_MAP[key])));

	const stack: string[] = [];
	for (const token of tokens) {
		if (closing.has(token.text)) {
			if (stack.length === 0) return token.end;
			stack.pop();
		} else if (opening.has(token.text)) {
			stack.push(token.text);
		}
	}
	return null;
}

/** Typing `)` when a `)` is already there should step over it, not double it. */
export function shouldTaboutByCloseBracket(win: any, keyPressed: string): boolean {
	const buffer = currentBuffer(win);
	if (!buffer || !buffer.inMath || buffer.from !== buffer.to) return false;
	const char = buffer.text.slice(buffer.to, buffer.to + 1);
	return char === keyPressed && [")", "]", "}"].includes(char);
}
