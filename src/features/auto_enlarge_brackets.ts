/* Ported from obsidian-latex-suite (src/features/auto_enlarge_brackets.ts).
 *
 * Upstream walks a lezer parse tree; here the equation is a short flat string,
 * so a bracket scan over it says the same thing for a fraction of the code.
 * All the pairs are enlarged in a single replacement so the cursor only has to
 * be adjusted once.
 */
import { currentBuffer } from "src/editor/index";
import { findMatchingBracket } from "src/utils/editor_utils";
import { Settings } from "src/settings/settings";

const SIZE_CONTROLS = [
	"\\big", "\\Big", "\\bigg", "\\Bigg",
	"\\bigl", "\\Bigl", "\\biggl", "\\Biggl",
	"\\bigr", "\\Bigr", "\\biggr", "\\Biggr",
	"\\left", "\\right",
];

const PAIRS: [string, string][] = [
	["(", ")"],
	["[", "]"],
	["\\{", "\\}"],
];

/** Is `pos` immediately preceded by `\left`, `\big` and friends? */
function afterSizeControl(text: string, pos: number): boolean {
	const before = text.slice(0, pos).trimEnd();
	return SIZE_CONTROLS.some((cmd) => before.endsWith(cmd));
}

type Edit = { from: number; to: number; insert: string };

export function autoEnlargeBrackets(win: any, settings: Settings): boolean {
	if (!settings.autoEnlargeBrackets) return false;

	const buffer = currentBuffer(win);
	if (!buffer || !buffer.inMath) return false;

	const text = buffer.text;
	const space = settings.autoEnlargeBracketsSpace ? " " : "";
	const edits: Edit[] = [];

	for (let i = 0; i < text.length; i++) {
		const pair = PAIRS.find(([open]) => text.startsWith(open, i));
		if (!pair) continue;

		const [open, close] = pair;
		if (afterSizeControl(text, i)) continue;

		const closeIndex = findMatchingBracket(text, i, open, close, false);
		if (closeIndex === null) continue;
		if (afterSizeControl(text, closeIndex)) continue;

		const content = text.slice(i + open.length, closeIndex);
		if (!settings.autoEnlargeBracketsTriggers.some((trigger) => content.includes(trigger))) continue;

		edits.push({ from: i, to: i + open.length, insert: `\\left${open}${space}` });
		edits.push({ from: closeIndex, to: closeIndex + close.length, insert: `${space}\\right${close}` });
	}

	if (edits.length === 0) return false;

	edits.sort((a, b) => a.from - b.from);

	let rebuilt = "";
	let offset = 0;
	let cursor = buffer.to;
	for (const edit of edits) {
		rebuilt += text.slice(offset, edit.from) + edit.insert;
		if (edit.to <= buffer.to) cursor += edit.insert.length - (edit.to - edit.from);
		offset = edit.to;
	}
	rebuilt += text.slice(offset);

	buffer.applyChange(0, text.length, rebuilt, [], { from: cursor, to: cursor });
	return true;
}
