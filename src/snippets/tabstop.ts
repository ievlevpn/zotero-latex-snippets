/* Tabstop grouping, ported from obsidian-latex-suite (src/snippets/tabstop.ts).
 *
 * The grouping rules are unchanged. What is gone is CodeMirror's decoration
 * machinery: ProseMirror has no multi-range selection, so a group is a list of
 * ranges of which the first is the one the cursor lands on.
 * ponytail: no placeholder highlight for pending tabstops — add a PM decoration
 * plugin if the selection alone turns out not to be enough feedback.
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
