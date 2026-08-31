/* Ported from obsidian-latex-suite (src/features/autofraction.ts).
 * The numerator scan is unchanged; only the editor calls differ.
 */
import { currentBuffer } from "src/editor/pm";
import { findMatchingBracket, getOpenBracket } from "src/utils/editor_utils";
import { Context } from "src/utils/context";
import { Settings } from "src/settings/settings";
import { ArrayNode, emptyInsertOptions, TabstopNode, TextNode } from "src/snippets/luasnip_api/node";
import { expandSnippet } from "src/snippets/snippet_management";
import { autoEnlargeBrackets } from "./auto_enlarge_brackets";

const GREEK =
	"alpha|beta|gamma|Gamma|delta|Delta|epsilon|varepsilon|zeta|eta|theta|Theta|iota|kappa|lambda|Lambda|mu|nu|omicron|xi|Xi|pi|Pi|rho|sigma|Sigma|tau|upsilon|Upsilon|varphi|phi|Phi|chi|psi|Psi|omega|Omega";
const GREEK_SPACE = new RegExp("(" + GREEK + ") ([^ ])", "g");

export function runAutoFraction(win: any, settings: Settings): boolean {
	const buffer = currentBuffer(win);
	if (!buffer || !buffer.inMath) return false;

	const ctx = Context.fromBuffer(buffer);
	if (!ctx.mode.strictlyInMath()) return false;

	for (const env of settings.autofractionExcludedEnvs) {
		if (ctx.isWithinEnvironment(env)) return false;
	}

	const bounds = ctx.getBounds();
	if (!bounds) return false;

	const { from, to } = buffer;
	const eqnStart = bounds.inner_start;
	let start = eqnStart;

	if (from !== to) {
		// A selection is the numerator, verbatim.
		start = from;
	} else {
		// Everything back to a breaking character, with bracketed groups skipped
		// over. Spaces after a greek letter belong to the letter, so they are
		// masked out before the scan.
		GREEK_SPACE.lastIndex = 0;
		const curLine = buffer.text.slice(eqnStart, to).replace(GREEK_SPACE, "$1#$2");

		for (let i = curLine.length - 1; i >= 0; i--) {
			const curChar = curLine.charAt(i);

			if ([")", "]", "}"].includes(curChar)) {
				const openBracket = getOpenBracket(curChar);
				const j = findMatchingBracket(curLine, i, openBracket, curChar, true);
				if (j === null) return false;
				i = j;
			}

			// `curChar`, not `curLine.charAt(i)`: after skipping back over a bracket
			// pair, `i` sits on the opening bracket, which is itself a breaking
			// character — testing it would stop the scan inside the group.
			if (" $([{\n".concat(settings.autofractionBreakingChars).includes(curChar)) {
				start = i + 1 + eqnStart;
				break;
			}
		}
	}

	if (start === to) return false;

	let numerator = buffer.text.slice(start, to);

	// Drop redundant outer parentheses: (a+b)/ -> \frac{a+b}{}
	if (numerator.at(0) === "(" && numerator.at(-1) === ")") {
		if (findMatchingBracket(numerator, 0, "(", ")", false) === numerator.length - 1) {
			numerator = numerator.slice(1, -1);
		}
	}

	const snippet = new ArrayNode([
		new TextNode(settings.autofractionSymbol + "{"),
		numerator === "" ? new TabstopNode(0) : new TextNode(numerator),
		new TextNode("}{"),
		new TabstopNode(1),
		new TextNode("}"),
		new TabstopNode(2),
	]);

	expandSnippet(buffer, start, to, snippet.applyInsert(emptyInsertOptions));
	autoEnlargeBrackets(win, settings);
	return true;
}
