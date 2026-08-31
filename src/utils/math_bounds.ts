/* Finding equations in plain text.
 *
 * Zotero notes don't need this — an equation there is a node, so "am I in
 * math?" is a node-type check. Annotation comments are plain text (only
 * <i>/<b>/<sub>/<sup> survive, see notes/zotero-note-editor.md), so math is
 * `$…$` / `$$…$$` the way it is in markdown, and has to be found by scanning.
 */

export type MathBounds = {
	display: boolean;
	/** position of the opening delimiter */
	outer_start: number;
	/** first position of the LaTeX source */
	inner_start: number;
	/** one past the last position of the LaTeX source */
	inner_end: number;
	/** one past the closing delimiter */
	outer_end: number;
	/** false when the closing delimiter has not been typed yet */
	closed: boolean;
};

/**
 * Every equation in `text`, left to right. An equation whose closing delimiter
 * is missing runs to the end of the text — while you are typing one, that is
 * the state it spends most of its time in.
 */
export function scanEquations(text: string): MathBounds[] {
	const found: MathBounds[] = [];
	let i = 0;

	while (i < text.length) {
		if (text[i] === "\\") { i += 2; continue; } // \$ is a literal dollar
		if (text[i] !== "$") { i++; continue; }

		const display = text[i + 1] === "$";
		const delim = display ? 2 : 1;
		const outer_start = i;
		const inner_start = i + delim;

		let j = inner_start;
		let close = -1;
		while (j < text.length) {
			if (text[j] === "\\") { j += 2; continue; }
			if (text[j] === "$" && (!display || text[j + 1] === "$")) { close = j; break; }
			j++;
		}

		if (close === -1) {
			found.push({ display, outer_start, inner_start, inner_end: text.length, outer_end: text.length, closed: false });
			break;
		}

		found.push({ display, outer_start, inner_start, inner_end: close, outer_end: close + delim, closed: true });
		i = close + delim;
	}

	return found;
}

/** The equation the cursor is inside, or null. Delimiters count as outside. */
export function mathBoundsAt(text: string, pos: number): MathBounds | null {
	for (const bounds of scanEquations(text)) {
		if (pos >= bounds.inner_start && pos <= bounds.inner_end) return bounds;
		if (bounds.outer_start > pos) break;
	}
	return null;
}

/**
 * The equations worth rendering.
 *
 * A reference manager is full of prices, so an inline `$…$` has to look like
 * an equation and not like "$5 and $10": non-empty, no space just inside either
 * delimiter, and no line break. Display math is unambiguous enough to skip the
 * test. This is deliberately stricter than what counts as math for snippets,
 * where an unclosed `$` you are still typing into has to count.
 */
export function renderableEquations(text: string): MathBounds[] {
	return scanEquations(text).filter((bounds) => {
		if (!bounds.closed) return false;
		const source = text.slice(bounds.inner_start, bounds.inner_end);
		if (!source.trim()) return false;
		if (bounds.display) return true;
		return !/^\s|\s$|\n/.test(source);
	});
}
