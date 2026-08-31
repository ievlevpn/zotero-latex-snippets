/* Expanding a snippet and walking its tabstops.
 *
 * Latex Suite queues change specs into a CodeMirror state field and flushes them
 * in one dispatch; here a snippet is always one contiguous replacement inside
 * one buffer, so it is one edit and the queue disappears.
 *
 * Tabstop positions are kept in whatever coordinates the buffer's backend uses
 * and remapped through every later edit to it, so typing into a placeholder
 * grows its range the way CodeMirror's mark decorations did.
 */
import { Buffer, Range } from "src/editor/buffer";
import { ResultInsert } from "./luasnip_api/node";
import { tabstopSpecsToTabstopGroups } from "./tabstop";

type ActiveSnippet = {
	owner: object;
	groups: Range[][];
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

	const owner = buffer.owner;
	buffer.watch((map) => {
		if (active && active.owner === owner) {
			active.groups = active.groups.map((group) => group.map(map));
		}
	});
	active = { owner, groups: placedGroups, index: 0 };
	return true;
}

/** Tab / Shift-Tab between tabstops. Returns false when there is nowhere to go. */
export function setSelectionToNextTabstop(buffer: Buffer, shiftKey: boolean): boolean {
	if (!active) return false;
	if (active.owner !== buffer.owner) {
		// A different buffer (or the same equation reopened as a fresh nested
		// view): the recorded positions no longer refer to anything.
		clearTabstops();
		return false;
	}

	const direction = shiftKey ? -1 : 1;
	let next = active.index + direction;

	const current = active.groups[active.index]?.[0];

	while (next >= 0 && next < active.groups.length) {
		const target = active.groups[next][0];
		// Adjacent tabstops can collapse onto the same spot; stepping onto one we
		// are already sitting at would make Tab look broken.
		if (current && target.from === current.from && target.to === current.to) {
			next += direction;
			continue;
		}

		buffer.selectRange(target);
		active.index = next;
		if (next === active.groups.length - 1 && direction === 1) clearTabstops();
		return true;
	}

	if (direction === 1) clearTabstops();
	return false;
}
