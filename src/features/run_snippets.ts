/* Ported from obsidian-latex-suite (src/features/run_snippets.ts).
 *
 * Same order of business: build the context, walk the snippets in priority
 * order, expand the first one that matches, optionally repeat. What differs is
 * that there is one cursor rather than many (ProseMirror has no multi-selection)
 * and one buffer rather than a whole document.
 */
import { Buffer } from "src/editor/buffer";
import { currentBuffer } from "src/editor/index";
import { asMathReplacement, expandAsMath } from "src/editor/insert_math";
import { Context } from "src/utils/context";
import { expandSnippet } from "src/snippets/snippet_management";
import { IncludedEnvironmentResult, Snippet } from "src/snippets/snippets";
import { ResultInsert } from "src/snippets/luasnip_api/node";
import { Settings } from "src/settings/settings";
import { autoEnlargeBrackets } from "./auto_enlarge_brackets";

export type SnippetInfo = { snippets: Snippet[]; key?: string };

/**
 * `known` is the buffer the caller already has, reused for the first pass —
 * building one means walking the editor, and doing it twice per keystroke is
 * exactly the sort of thing that adds up.
 */
export function runSnippets(win: any, snippetInfo: SnippetInfo, settings: Settings, known?: Buffer): boolean {
	let didExpand = false;

	for (let i = 0; i <= settings.snippetRecursion; i++) {
		const buffer = i === 0 && known ? known : currentBuffer(win);
		if (!buffer) break;

		const ctx = Context.fromBuffer(buffer);
		const result = runSnippetCursor(win, buffer, ctx, snippetInfo, settings);
		if (!result.success) break;

		didExpand = true;
		if (result.shouldAutoEnlargeBrackets) autoEnlargeBrackets(win, settings);
		snippetInfo.key = undefined; // the keypress only counts once
	}

	return didExpand;
}

/** Insert a snippet result, turning `$…$` in text mode into a real equation. */
export function expand(win: any, buffer: Buffer, from: number, to: number, replacement: ResultInsert): boolean {
	if (!buffer.inMath && !buffer.dollarMath) {
		const math = asMathReplacement(replacement);
		if (math && expandAsMath(win, buffer, from, to, math)) return true;
	}
	return expandSnippet(buffer, from, to, replacement);
}

function runSnippetCursor(
	win: any,
	buffer: Buffer,
	ctx: Context,
	snippetInfo: SnippetInfo,
	settings: Settings,
): { success: boolean; shouldAutoEnlargeBrackets: boolean } {
	const miss = { success: false, shouldAutoEnlargeBrackets: false };

	const key = snippetInfo.key ?? "";
	if (snippetInfo.key && snippetInfo.key.length !== 1) return miss;

	const { from, to } = { from: buffer.from, to: buffer.to };
	const sel = buffer.selectedText;
	const line = buffer.text.slice(0, to);
	let cachedLineAfter: string | null = null;
	const effectiveLineAfter = () => (cachedLineAfter ??= buffer.text.slice(to));
	const effectiveLine = line + key;

	const scopes = ctx.getEnvNames();
	const api = { _view: buffer.owner, _buffer: buffer };

	for (const snippet of snippetInfo.snippets) {
		const inIncludedScope = snippet.isWithinIncludedScope(scopes);
		if (inIncludedScope === IncludedEnvironmentResult.NotIncluded) continue;
		if (!snippet.options.snippetShouldRunInMode(ctx.mode, inIncludedScope === IncludedEnvironmentResult.Included)) {
			continue;
		}

		const result = snippet.process({ effectiveLine, range: { from, to }, sel, effectiveLineAfter, api });
		if (result === null) continue;
		if (snippet.isWithinExcludedScope(scopes)) continue;

		const triggerPos = result.triggerPos;
		const triggerEndPos = result.triggerEndPos !== undefined ? result.triggerEndPos - key.length : to;

		if (snippet.options.onWordBoundary && !isOnWordBoundary(buffer.text, triggerPos, to, settings.wordDelimiters)) {
			continue;
		}

		let replacement = result.replacement;
		if (ctx.mode.inlineMath && settings.removeSnippetWhitespace) {
			replacement = trimWhitespace(replacement);
		}

		if (settings.snippetDebug !== "off") {
			console.debug("latex-snippets: expanding", snippet.description, "->", replacement.insert);
		}

		const containsTrigger = settings.autoEnlargeBracketsTriggers.some((word) => replacement.insert.includes(word));
		expand(win, buffer, triggerPos, triggerEndPos, replacement);
		return { success: true, shouldAutoEnlargeBrackets: containsTrigger };
	}

	return miss;
}

function isOnWordBoundary(text: string, triggerPos: number, to: number, wordDelimiters: string) {
	const prevChar = text.slice(triggerPos - 1, triggerPos);
	const nextChar = text.slice(to, to + 1);
	const delimiters = wordDelimiters.replace("\\n", "\n");
	return delimiters.includes(prevChar) && delimiters.includes(nextChar);
}

/**
 * In inline math, a trailing space (or " $N") before the closing delimiter reads
 * badly. Tabstops are clamped to the shortened text: a snippet ending in " $2"
 * has a tabstop exactly where the trimmed space was, and leaving it past the end
 * makes the selection unrepresentable.
 */
function trimWhitespace(replacement: ResultInsert): ResultInsert {
	let insert = replacement.insert;

	if (insert.endsWith(" ")) {
		insert = insert.trimEnd();
	} else {
		const lastThree = insert.slice(-3);
		if (lastThree.slice(0, 2) === " $" && !isNaN(parseInt(lastThree.slice(-1)))) {
			insert = insert.slice(0, -3) + insert.slice(-2);
		}
	}

	if (insert === replacement.insert) return replacement;

	const clamp = (n: number) => Math.min(n, insert.length);
	return { insert, tabstops: replacement.tabstops.map((ts) => ({ ...ts, from: clamp(ts.from), to: clamp(ts.to) })) };
}
