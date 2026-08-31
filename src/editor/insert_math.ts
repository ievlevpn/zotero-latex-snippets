/* Turning a text-mode replacement into an equation.
 *
 * Latex Suite's `mk` and `dm` snippets expand to `$…$` and `$$…$$` because in
 * markdown that *is* math. Zotero has no `$`: an equation is a node. So a
 * text-mode replacement wrapped in dollars is read as "make an equation here",
 * and the tabstops inside it land inside the new node — which is what those
 * snippets mean.
 */
import { getActiveMathView, getEditorCore, nodeSelection, PMBuffer, PMView, rememberSelectionClass } from "./pm";
import { Buffer } from "./buffer";
import { ResultInsert } from "src/snippets/luasnip_api/node";
import { expandSnippet } from "src/snippets/snippet_management";

export type MathReplacement = { display: boolean; inner: ResultInsert };

/** `$…$` / `$$…$$` around the whole replacement, or null. */
export function asMathReplacement(result: ResultInsert): MathReplacement | null {
	const text = result.insert;
	let delim = 0;
	if (/^\$\$[\s\S]*\$\$$/.test(text) && text.length >= 4) delim = 2;
	else if (/^\$[\s\S]*\$$/.test(text) && text.length >= 2) delim = 1;
	else return null;

	let inner = text.slice(delim, text.length - delim);

	// `dm` is written as "$$\n$0\n$$": the newlines are markdown's way of making
	// the block display, not part of the equation. Strip them, but never past a
	// tabstop — in `dm` the tabstop sits between the two newlines.
	const offsets = result.tabstops.map((ts) => ts.from - delim).concat(result.tabstops.map((ts) => ts.to - delim));
	const firstStop = offsets.length ? Math.min(...offsets) : inner.length;
	const lastStop = offsets.length ? Math.max(...offsets) : 0;

	let lead = 0;
	while (lead < firstStop && inner[lead] === "\n") lead++;
	let end = inner.length;
	while (end > lead && end > lastStop && inner[end - 1] === "\n") end--;
	inner = inner.slice(lead, end);

	const shift = delim + lead;
	const tabstops = result.tabstops
		.map((ts) => ({ ...ts, from: ts.from - shift, to: ts.to - shift }))
		.filter((ts) => ts.from >= 0 && ts.to <= inner.length);

	return { display: delim === 2, inner: { insert: inner, tabstops } };
}

function schemaOf(view: PMView) {
	return view.state.schema;
}

/**
 * Insert an empty equation node at the cursor and open its editor.
 *
 * Opening the editor means putting a `NodeSelection` on the node — that is what
 * prosemirror-math listens for. When we have not seen a NodeSelection yet this
 * session we borrow Zotero's own `insertMath()`, which builds one; it picks
 * display vs inline by whether the block is empty, so the caller arranges that.
 */
function insertEmptyMath(core: any, display: boolean) {
	const view = core.view;
	const schema = schemaOf(view);
	const type = display ? schema.nodes.math_display : schema.nodes.math_inline;

	const { $from, from } = view.state.selection;
	const tr = view.state.tr;
	let at = from;

	if (display) {
		const range = $from.blockRange($from);
		if (!range) return core.insertMath();
		tr.replaceWith(range.start, range.end, type.create(null));
		at = range.start;
	} else {
		tr.insert(from, type.create(null));
	}

	const sel = nodeSelection(tr.doc, at);
	if (!sel) return core.insertMath();

	tr.setSelection(sel);
	view.dispatch(tr);
}

/**
 * Replace `[from, to)` in a text buffer with a new equation holding `inner`.
 * Returns false if the equation could not be created, so the caller can fall
 * back to inserting the replacement as literal text.
 */
export function expandAsMath(win: any, buffer: Buffer, from: number, to: number, math: MathReplacement): boolean {
	const core = getEditorCore(win);
	const schema = core?.view?.state?.schema;
	const type = math.display ? schema?.nodes?.math_display : schema?.nodes?.math_inline;
	// Everything that can fail is checked before the first edit: once the trigger
	// is gone the caller has nothing sensible to fall back to.
	if (!core?.view || !type) return false;

	buffer.applyChange(from, to, "");

	if (math.display) {
		// Display math replaces a whole block, so make sure the block it takes
		// over is empty rather than swallowing the rest of the line.
		const sel = core.view.state.selection;
		if (sel.$from.parent.content.size > 0) {
			const tr = core.view.state.tr;
			tr.split(sel.from);
			core.view.dispatch(tr);
		}
	}

	insertEmptyMath(core, math.display);
	rememberSelectionClass(core.view);

	const active = getActiveMathView(win.document);
	if (!active) {
		console.error("latex-snippets: could not open the equation that was just created");
		return true;
	}
	rememberSelectionClass(active.view);

	const mathBuffer = PMBuffer.forMath(active.view, active.kind);
	expandSnippet(mathBuffer, 0, mathBuffer.text.length, math.inner);
	return true;
}
