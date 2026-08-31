/* Expanding a snippet and walking its tabstops.
 *
 * Latex Suite queues change specs into a CodeMirror state field and flushes them
 * in one dispatch; here a snippet is always one contiguous replacement inside one
 * buffer, so it is one ProseMirror transaction and the queue disappears.
 *
 * Tabstop positions are kept as ProseMirror positions and mapped through every
 * later transaction on that view, so typing into a placeholder grows its range
 * the way CodeMirror's mark decorations did.
 */
import { Buffer, PMView, textSelection } from "src/editor/pm";
import { ResultInsert } from "./luasnip_api/node";
import { TabstopRange, tabstopSpecsToTabstopGroups } from "./tabstop";

type ActiveSnippet = {
	view: PMView;
	groups: TabstopRange[][];
	index: number;
};

// ponytail: one snippet in flight at a time. Nested expansions reset the
// tabstops of the outer one, which is what happens in practice anyway.
let active: ActiveSnippet | null = null;

export function clearTabstops() {
	active = null;
}

export function hasTabstops() {
	return active !== null;
}

/**
 * Keep tabstop positions valid across edits made by anyone — us, the user, or
 * the outer editor syncing an equation back into a nested view.
 */
function watchView(view: PMView) {
	if (view.__latexSnippetsWatched) return;
	view.__latexSnippetsWatched = true;
	const original = view.dispatch.bind(view);
	view.dispatch = (tr: any) => {
		if (active && active.view === view && tr.docChanged) {
			active.groups = active.groups.map((group) =>
				group.map((range) => ({
					// -1 / 1 so text typed inside a placeholder extends it
					from: tr.mapping.map(range.from, -1),
					to: tr.mapping.map(range.to, 1),
				})),
			);
		}
		return original(tr);
	};
}

/** Replace `[from, to)` in `buffer` with a snippet result, then select tabstop 0. */
export function expandSnippet(buffer: Buffer, from: number, to: number, result: ResultInsert): boolean {
	const groups = tabstopSpecsToTabstopGroups(result.tabstops);
	const flat = groups.flat();

	const selection = groups.length ? groups[0][0] : undefined;
	const placed = buffer.applyChange(from, to, result.insert, flat, selection);

	if (!groups.length) {
		clearTabstops();
		return true;
	}

	// Re-bucket the placed positions the way they were grouped.
	let cursor = 0;
	const placedGroups = groups.map((group) => group.map(() => placed[cursor++]));

	watchView(buffer.view);
	active = { view: buffer.view, groups: placedGroups, index: 0 };
	return true;
}

/** Tab / Shift-Tab between tabstops. Returns false when there is nowhere to go. */
export function setSelectionToNextTabstop(view: PMView, shiftKey: boolean): boolean {
	if (!active) return false;
	if (active.view !== view) {
		// A different buffer (or the same equation reopened as a fresh nested
		// view): the recorded positions no longer refer to anything.
		clearTabstops();
		return false;
	}

	const direction = shiftKey ? -1 : 1;
	let next = active.index + direction;

	while (next >= 0 && next < active.groups.length) {
		const target = active.groups[next][0];
		const current = view.state.selection;
		if (current.from === target.from && current.to === target.to) {
			next += direction;
			continue;
		}

		const tr = view.state.tr;
		const sel = textSelection(tr.doc, target.from, target.to);
		if (!sel) return false;
		tr.setSelection(sel);
		view.dispatch(tr);

		active.index = next;
		if (next === active.groups.length - 1 && direction === 1) clearTabstops();
		return true;
	}

	if (direction === 1) clearTabstops();
	return false;
}
