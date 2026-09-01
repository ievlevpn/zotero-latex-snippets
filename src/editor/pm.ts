/* The ProseMirror side of the port.
 *
 * Latex Suite talks to CodeMirror, where the document is one flat string.
 * Zotero's note editor is ProseMirror, where an equation is a `math_inline` /
 * `math_display` node whose content is plain unmarked text, edited in a nested
 * EditorView. That nested view *is* a flat string with a cursor, so the whole
 * engine ports across once we can find it — which is what this file does.
 *
 * See notes/zotero-note-editor.md for where these internals come from.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { Buffer, BufferKind, Range } from "./buffer";
import { MathBounds } from "src/utils/math_bounds";

export type PMView = any;
export type PMNode = any;
export type PMTransaction = any;

/** `resource://zotero/note-editor/editor.js` hangs the note editor off `window`. */
export function getEditorCore(win: any): any {
	return win._currentEditorInstance?._editorCore ?? null;
}

/**
 * The nested EditorView of the equation the cursor is in, or null.
 *
 * `ViewDesc` writes itself onto `dom.pmViewDesc`, and a custom node view's desc
 * keeps the node view object in `.spec` — for math that object is
 * prosemirror-math's `MathView`, which owns `_innerView`.
 */
export function getActiveMathView(doc: Document): { view: PMView; kind: BufferKind } | null {
	const active = doc.activeElement;
	if (!active) return null;
	const el = (active as Element).closest?.(".math-node") as any;
	const inner = el?.pmViewDesc?.spec?._innerView;
	if (!inner) return null;
	return { view: inner, kind: el.tagName.toLowerCase() === "math-display" ? "math_display" : "math_inline" };
}

/* ProseMirror's selection classes. There is no module to import them from
 * inside the note editor, so they are harvested from live selections: a caret
 * gives TextSelection, and clicking an equation or an image gives NodeSelection.
 * Both are stable for the lifetime of the window once seen. */
let TextSelectionClass: any = null;
let NodeSelectionClass: any = null;

export function rememberSelectionClass(view: PMView) {
	const sel = view?.state?.selection;
	if (!sel) return;
	if (sel.node) NodeSelectionClass ??= sel.constructor;
	else if (sel.$from && sel.$to) TextSelectionClass ??= sel.constructor;
}

export function textSelection(doc: PMNode, from: number, to: number): any | null {
	if (!TextSelectionClass) return null;
	return TextSelectionClass.create(doc, from, to);
}

/** ProseMirror's `Selection.near`, for positions that may not be in a textblock. */
export function nearSelection(doc: PMNode, pos: number, bias: 1 | -1 = 1): any | null {
	if (!TextSelectionClass) return null;
	const Selection = Object.getPrototypeOf(TextSelectionClass);
	try {
		return Selection.near(doc.resolve(pos), bias);
	} catch {
		return null;
	}
}

/**
 * A NodeSelection, which is what prosemirror-math watches for to open an
 * equation's editor.
 *
 * There is no module to import it from, but ProseMirror registers its selection
 * classes for deserialisation — `Selection.jsonID("node", NodeSelection)` — so
 * `Selection.fromJSON` reaches it by name. That is deterministic: it does not
 * depend on having happened to observe a NodeSelection first.
 */
export function nodeSelection(doc: PMNode, pos: number): any | null {
	if (!NodeSelectionClass && TextSelectionClass) {
		try {
			const Selection = Object.getPrototypeOf(TextSelectionClass);
			NodeSelectionClass = Selection.fromJSON(doc, { type: "node", anchor: pos }).constructor;
		} catch {
			/* fall back to whatever has been seen */
		}
	}
	if (!NodeSelectionClass) return null;
	try {
		return NodeSelectionClass.create(doc, pos);
	} catch {
		return null;
	}
}

type Segment = { textOff: number; textLen: number; pmOff: number; pmLen: number };

/**
 * A flat-string view of whatever the cursor is currently editing: the source of
 * an equation, or the inline content of one text block.
 *
 * Text offsets and ProseMirror positions only coincide inside math (`text*`
 * with no marks); in a paragraph an inline atom — an image, a citation, a
 * nested equation — is one character of text but several ProseMirror positions,
 * so the two are kept apart behind `pmPos`.
 */
export class PMBuffer implements Buffer {
	view: PMView;
	kind: BufferKind;
	text: string;
	/** selection, as offsets into `text` */
	from: number;
	to: number;
	/** ProseMirror position of text offset 0 */
	base: number;
	private segments: Segment[];

	private constructor(view: PMView, kind: BufferKind, text: string, base: number, segments: Segment[], from: number, to: number) {
		this.view = view;
		this.kind = kind;
		this.text = text;
		this.base = base;
		this.segments = segments;
		this.from = from;
		this.to = to;
	}

	get owner(): object {
		return this.view;
	}

	get inMath() {
		return this.kind === "math_inline" || this.kind === "math_display";
	}

	/** Equations are nodes here, so dollars in the text are just dollars. */
	get dollarMath() {
		return false;
	}

	/** An equation node *is* the buffer, so its bounds are the whole of it. */
	get mathBounds(): MathBounds | null {
		if (!this.inMath) return null;
		return {
			display: this.kind === "math_display",
			outer_start: 0,
			inner_start: 0,
			inner_end: this.text.length,
			outer_end: this.text.length,
			closed: true,
		};
	}

	get selectedText() {
		return this.text.slice(this.from, this.to);
	}

	/** Text offset -> ProseMirror position. */
	pmPos(offset: number): number {
		for (const seg of this.segments) {
			if (offset <= seg.textOff + seg.textLen) {
				if (seg.textLen === seg.pmLen) return this.base + seg.pmOff + (offset - seg.textOff);
				// atom: it is either before it or after it, never inside
				return this.base + seg.pmOff + (offset > seg.textOff ? seg.pmLen : 0);
			}
		}
		return this.base + this.text.length;
	}

	/** ProseMirror position -> text offset. */
	textOffset(pos: number): number {
		const rel = pos - this.base;
		for (const seg of this.segments) {
			if (rel <= seg.pmOff + seg.pmLen) {
				if (seg.textLen === seg.pmLen) return seg.textOff + (rel - seg.pmOff);
				return seg.textOff + (rel > seg.pmOff ? 1 : 0);
			}
		}
		return this.text.length;
	}

	static forMath(view: PMView, kind: BufferKind): PMBuffer {
		const doc = view.state.doc;
		const text = doc.textContent;
		const sel = view.state.selection;
		const segments: Segment[] = [{ textOff: 0, textLen: text.length, pmOff: 0, pmLen: text.length }];
		return new PMBuffer(view, kind, text, 0, segments, sel.from, sel.to);
	}

	static forTextBlock(view: PMView): PMBuffer | null {
		const sel = view.state.selection;
		const $from = sel.$from;
		const parent = $from.parent;
		if (!parent || !parent.isTextblock) return null;

		const segments: Segment[] = [];
		let text = "";
		let pmOff = 0;
		parent.forEach((node: PMNode) => {
			if (node.isText) {
				segments.push({ textOff: text.length, textLen: node.text.length, pmOff, pmLen: node.text.length });
				text += node.text;
				pmOff += node.text.length;
			} else {
				// One object-replacement character, exactly like Zotero's own
				// inline-math input rule does when it looks at a paragraph.
				segments.push({ textOff: text.length, textLen: 1, pmOff, pmLen: node.nodeSize });
				text += "￼";
				pmOff += node.nodeSize;
			}
		});

		const base = $from.start();
		const kind: BufferKind = parent.type.name === "codeBlock" ? "code" : "text";
		const buf = new PMBuffer(view, kind, text, base, segments, 0, 0);
		buf.from = buf.textOffset(sel.from);
		buf.to = buf.textOffset(sel.to);
		return buf;
	}

	/** Build the inline content for `insert`, carrying marks and turning \n into hard breaks. */
	private fragment(insert: string, at: number): PMNode[] {
		const schema = this.view.state.schema;
		if (this.inMath) return insert.length ? [schema.text(insert)] : [];

		const marks = this.view.state.doc.resolve(at).marks();
		const hardBreak = schema.nodes.hardBreak;
		const out: PMNode[] = [];
		const lines = insert.split("\n");
		lines.forEach((line, i) => {
			if (i > 0 && hardBreak) out.push(hardBreak.create());
			if (line.length) out.push(schema.text(line, marks));
		});
		return out;
	}

	/**
	 * Replace `[from, to)` with `insert` in one transaction, and report where the
	 * given tabstop ranges — offsets into `insert` — ended up, as ProseMirror
	 * positions. Inserted text is 1:1 with positions (a hard break is one of
	 * each), so ranges inside the insertion map by simple arithmetic.
	 */
	applyChange(
		from: number,
		to: number,
		insert: string,
		tabstops: readonly Range[] = [],
		selection?: Range,
	): Range[] {
		const pmFrom = this.pmPos(from);
		const pmTo = this.pmPos(to);
		const tr = this.view.state.tr;
		tr.replaceWith(pmFrom, pmTo, this.fragment(insert, pmFrom));

		const at = (offsetInInsert: number) => pmFrom + offsetInInsert;
		const ranges = tabstops.map((ts) => ({ from: at(ts.from), to: at(ts.to) }));

		const sel = selection
			? textSelection(tr.doc, at(selection.from), at(selection.to))
			: textSelection(tr.doc, at(insert.length), at(insert.length));
		if (sel) tr.setSelection(sel);

		this.view.dispatch(tr);
		return ranges;
	}

	replaceRange(from: number, to: number, insert: string) {
		this.applyChange(from, to, insert);
	}

	editRange(from: number, to: number, insert: string) {
		const pmFrom = this.pmPos(from);
		const pmTo = this.pmPos(to);
		const tr = this.view.state.tr;
		tr.replaceWith(pmFrom, pmTo, this.fragment(insert, pmFrom));
		// No setSelection: ProseMirror maps the existing one through the change.
		this.view.dispatch(tr);
	}

	/** Move the cursor, using text offsets. */
	setSelection(from: number, to: number = from) {
		this.setSelectionPM(this.pmPos(from), this.pmPos(to));
	}

	selectRange(range: Range) {
		this.setSelectionPM(range.from, range.to);
	}

	positionAt(offset: number) {
		return this.pmPos(offset);
	}

	exitMath(): boolean {
		return this.inMath && exitMath(this.view);
	}

	get document(): Document {
		return this.view.dom.ownerDocument;
	}

	clientRects(range: Range): DOMRect[] {
		try {
			const from = this.view.domAtPos(range.from);
			const to = this.view.domAtPos(range.to);
			const domRange = this.document.createRange();
			domRange.setStart(from.node, from.offset);
			domRange.setEnd(to.node, to.offset);
			return Array.from(domRange.getClientRects());
		} catch {
			return [];
		}
	}

	/**
	 * Positions stay valid by being mapped through every transaction on this
	 * view — including the ones prosemirror-math makes when the outer document
	 * syncs an equation back into its nested view.
	 */
	watch(remap: (map: (range: Range) => Range) => void) {
		const view = this.view;
		if (view.__latexSuiteWatched) return;
		view.__latexSuiteWatched = true;
		const original = view.dispatch.bind(view);
		view.dispatch = (tr: any) => {
			// -1 / 1 so text typed inside a placeholder extends it
			if (tr.docChanged) remap((r) => ({ from: tr.mapping.map(r.from, -1), to: tr.mapping.map(r.to, 1) }));
			return original(tr);
		};
	}

	setSelectionPM(pmFrom: number, pmTo: number = pmFrom) {
		const tr = this.view.state.tr;
		const sel = textSelection(tr.doc, pmFrom, pmTo);
		if (!sel) return;
		tr.setSelection(sel);
		this.view.dispatch(tr);
	}
}

/**
 * Typing reaches ProseMirror's state through a DOM observer, and it is
 * ProseMirror's own keydown handler that flushes it. We intercept in the capture
 * phase and stop propagation, so that flush never happens — without this the
 * engine would read a state one keystroke behind whatever is on screen.
 */
function flush(view: PMView) {
	try {
		view?.domObserver?.forceFlush?.();
	} catch {
		/* older or future ProseMirror: fall through to whatever state we have */
	}
}

/** The buffer the cursor is in right now, math first. */
export function currentBuffer(win: any): PMBuffer | null {
	const core = getEditorCore(win);
	if (core?.view) flush(core.view);

	const math = getActiveMathView(win.document);
	if (math) {
		flush(math.view);
		rememberSelectionClass(math.view);
		return PMBuffer.forMath(math.view, math.kind);
	}

	if (!core?.view || !core.view.hasFocus()) return null;
	rememberSelectionClass(core.view);
	return PMBuffer.forTextBlock(core.view);
}

/**
 * Move the cursor out of the equation the user is editing, to just after it.
 * prosemirror-math closes the nested editor and re-renders the KaTeX itself.
 */
export function exitMath(innerView: PMView): boolean {
	const el = innerView?.dom?.closest?.(".math-node") as any;
	const mathView = el?.pmViewDesc?.spec;
	const core = getEditorCore(innerView?.dom?.ownerDocument?.defaultView);
	if (!mathView || !core?.view) return false;

	const pos = mathView._getPos();
	if (typeof pos !== "number") return false;

	const outer = core.view;
	const after = pos + mathView._node.nodeSize;

	if (after >= outer.state.doc.content.size) {
		// A display equation at the very end of the note has nothing to step
		// into, so give it a paragraph.
		const paragraph = outer.state.schema.nodes.paragraph;
		if (!paragraph) return false;
		const tr = outer.state.tr;
		tr.insert(after, paragraph.create());
		const sel = nearSelection(tr.doc, after + 1, 1);
		if (!sel) return false;
		tr.setSelection(sel);
		outer.dispatch(tr);
		outer.focus();
		return true;
	}

	const sel = nearSelection(outer.state.doc, after, 1);
	if (!sel) return false;
	outer.dispatch(outer.state.tr.setSelection(sel));
	outer.focus();
	return true;
}
