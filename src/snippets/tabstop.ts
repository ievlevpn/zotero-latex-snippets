/* Tabstop grouping, ported from obsidian-latex-suite (src/snippets/tabstop.ts).
 *
 * The grouping rules are unchanged. What is gone is CodeMirror's decoration
 * machinery: pending tabstops are marked by an overlay drawn over the text
 * instead (see tabstop_marks.ts).
 *
 * One limit is not a shortcut but the platform: tabstops sharing a number are
 * all inserted, and the cursor lands on the first. Latex Suite puts a cursor in
 * each, and neither ProseMirror nor a contenteditable has more than one
 * selection to give.
 */

export interface TabstopSpec {
	/** Nested index, so tabstops from nested snippets keep their ordering. */
	index: number[];
	from: number;
	to: number;
}

export type TabstopRange = { from: number; to: number };

/** Sort by nested index, collapse equal indices, and bucket into groups. */
export function tabstopSpecsToTabstopGroups(tabstops: readonly TabstopSpec[]): TabstopRange[][] {
	let currentIndex = 0;
	const flattened = tabstops
		.slice()
		.sort((a, b) => {
			for (let i = 0; i < Math.min(a.index.length, b.index.length); i++) {
				if (a.index[i] !== b.index[i]) return a.index[i] - b.index[i];
			}
			return a.index.length - b.index.length;
		})
		.map((ts, i, arr) => {
			if (i === 0) return { from: ts.from, to: ts.to, index: currentIndex };
			const prev = arr[i - 1].index;
			const sameIndex = ts.index.length === prev.length && ts.index.every((v, k) => v === prev[k]);
			if (!sameIndex) currentIndex += 1;
			return { from: ts.from, to: ts.to, index: currentIndex };
		});

	const groups: TabstopRange[][] = [];
	for (const ts of flattened) {
		(groups[ts.index] ??= []).push({ from: ts.from, to: ts.to });
	}
	return groups.filter(Boolean);
}
