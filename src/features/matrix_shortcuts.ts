/* Ported from obsidian-latex-suite (src/features/matrix_shortcuts.ts).
 *
 * Inside pmatrix/cases/align/…: Tab adds a cell, Enter adds a row, Shift-Enter
 * leaves. Upstream reads document lines; an equation here is one string, so
 * "line" means "between newlines in the equation source".
 */
import { Buffer, currentBuffer, exitMath } from "src/editor/pm";
import { Context, Scope } from "src/utils/context";
import { Settings } from "src/settings/settings";
import { taboutByEnclosedBrackets } from "./tabout";

type Shortcut = (win: any, buffer: Buffer, ctx: Context, scope: Scope, settings: Settings) => boolean;

function lineAround(text: string, pos: number) {
	const from = text.lastIndexOf("\n", pos - 1) + 1;
	const toIndex = text.indexOf("\n", pos);
	return { from, to: toIndex === -1 ? text.length : toIndex };
}

const isMultiline = (buffer: Buffer) => buffer.text.includes("\n");

/** Enter: `\\` and a new row, keeping the leading `&` padding of the current one. */
const newlineShortcut: Shortcut = (_win, buffer) => {
	const line = lineAround(buffer.text, buffer.to);
	const lineText = buffer.text.slice(line.from, line.to);
	const addedCells = lineText.match(/(\\begin\{[^}]*\}|\\\\|^)((?:\s|&)+)/)?.[2].trimStart() ?? "";

	buffer.replaceRange(buffer.to, buffer.to, isMultiline(buffer) ? ` \\\\\n${addedCells}` : ` \\\\  ${addedCells}`);
	return true;
};

/** Tab: a new cell. */
const addCellShortcut: Shortcut = (_win, buffer) => {
	if (buffer.from !== buffer.to) return false;
	buffer.replaceRange(buffer.from, buffer.to, " & ");
	return true;
};

/** Shift-Enter: end of the next row, or out of the equation. */
const exitShortcut: Shortcut = (win, buffer, _ctx, _scope, settings) => {
	if (!isMultiline(buffer)) return exitMath(win);

	const line = lineAround(buffer.text, buffer.to);
	if (line.to >= buffer.text.length) return exitMath(win);

	const next = lineAround(buffer.text, line.to + 1);
	const nextText = buffer.text.slice(next.from, next.to);

	let to = next.to;
	const endMatrix = /\\end\{([^}]*)\}/.exec(nextText);
	if (endMatrix && settings.matrixShortcutsEnvNames.includes(endMatrix[1])) {
		to = next.from + endMatrix.index + endMatrix[0].length;
	}

	buffer.setSelection(to);
	return true;
};

/** Tab, when the cursor is inside brackets: step past the closing one first. */
const priorityTaboutShortcut: Shortcut = (_win, buffer, _ctx, _scope, settings) => {
	const after = buffer.text.slice(buffer.to);
	const bracketEnd = taboutByEnclosedBrackets(after, settings.taboutClosingSymbols);
	if (bracketEnd === null) return false;
	buffer.setSelection(buffer.to + bracketEnd);
	return true;
};

function runner(shortcut: Shortcut) {
	return (win: any, settings: Settings): boolean => {
		if (!settings.matrixShortcutsEnabled) return false;

		const buffer = currentBuffer(win);
		if (!buffer || !buffer.inMath) return false;

		const ctx = Context.fromBuffer(buffer);
		if (!ctx.mode.strictlyInMath()) return false;

		const scope = ctx.getEnvNames()[0];
		if (!scope) return false;
		if (scope.kind === "environment" && !settings.matrixShortcutsEnvNames.includes(scope.name)) return false;
		if (scope.kind === "command" && !settings.matrixShortcutsMacroNames.includes(scope.name)) return false;
		if (scope.kind === "group") return false;

		return shortcut(win, buffer, ctx, scope, settings);
	};
}

export const newlineMatrixShortcut = runner(newlineShortcut);
export const addCellMatrixShortcut = runner(addCellShortcut);
export const exitMatrixShortcut = runner(exitShortcut);
export const priorityTaboutMatrixShortcut = runner(priorityTaboutShortcut);
