/* The annotation-comment backend.
 *
 * Zotero's reader edits annotation comments in a plain contenteditable holding
 * plain text — no ProseMirror, and only <i>/<b>/<sub>/<sup> survive a round
 * trip, so an equation there is `$…$` literal text, exactly as in markdown.
 * See notes/zotero-note-editor.md.
 *
 * Edits go through `document.execCommand("insertText")` rather than writing to
 * the DOM: that keeps the browser's undo stack intact and fires the `input`
 * event the reader's React component listens for to persist the comment.
 */
import { Buffer, BufferKind, Range } from "./buffer";
import { MathBounds, mathBoundsAt } from "src/utils/math_bounds";

/** The comment fields we act in. The `text` field holds the quoted passage. */
const EDITABLE_SELECTOR = '.annotation .comment [contenteditable="true"]';

type Segment = { start: number; length: number; node: Text | null; br: Element | null };

function segmentsOf(root: Element): { segments: Segment[]; text: string } {
	const segments: Segment[] = [];
	let text = "";
	const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
	let node: Node | null;
	while ((node = walker.nextNode())) {
		if (node.nodeType === 3) {
			const value = (node as Text).data;
			segments.push({ start: text.length, length: value.length, node: node as Text, br: null });
			text += value;
		} else if ((node as Element).nodeName === "BR") {
			segments.push({ start: text.length, length: 1, node: null, br: node as Element });
			text += "\n";
		}
	}
	return { segments, text };
}

/** Text offsets are the reader's own convention — concatenated text nodes — plus one character per <br>. */
export class TextBuffer implements Buffer {
	readonly element: HTMLElement;
	readonly text: string;
	readonly from: number;
	readonly to: number;
	readonly mathBounds: MathBounds | null;
	private segments: Segment[];

	private constructor(element: HTMLElement, text: string, segments: Segment[], from: number, to: number) {
		this.element = element;
		this.text = text;
		this.segments = segments;
		this.from = from;
		this.to = to;
		this.mathBounds = mathBoundsAt(text, to);
	}

	get owner(): object {
		return this.element;
	}

	get kind(): BufferKind {
		if (!this.mathBounds) return "text";
		return this.mathBounds.display ? "math_display" : "math_inline";
	}

	get inMath() {
		return this.mathBounds !== null;
	}

	get selectedText() {
		return this.text.slice(this.from, this.to);
	}

	/** Here `$…$` *is* math, so a replacement containing dollars needs no special handling. */
	get dollarMath() {
		return true;
	}

	static forElement(element: HTMLElement): TextBuffer | null {
		const { segments, text } = segmentsOf(element);
		const selection = element.ownerDocument.defaultView?.getSelection();
		if (!selection || selection.rangeCount === 0) return null;

		const range = selection.getRangeAt(0);
		if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) return null;

		const offsetOf = (container: Node, offset: number) => {
			const measure = element.ownerDocument.createRange();
			measure.selectNodeContents(element);
			measure.setEnd(container, offset);
			// Range.toString() drops <br>, so add them back to stay in step with `text`.
			const fragment = measure.cloneContents();
			return measure.toString().length + fragment.querySelectorAll("br").length;
		};

		return new TextBuffer(element, text, segments, offsetOf(range.startContainer, range.startOffset), offsetOf(range.endContainer, range.endOffset));
	}

	private domPoint(offset: number): { node: Node; offset: number } {
		for (const segment of this.segments) {
			if (offset > segment.start + segment.length) continue;
			if (segment.node) return { node: segment.node, offset: offset - segment.start };
			const parent = segment.br!.parentNode!;
			const index = Array.prototype.indexOf.call(parent.childNodes, segment.br);
			return { node: parent, offset: offset === segment.start ? index : index + 1 };
		}
		return { node: this.element, offset: this.element.childNodes.length };
	}

	private select(from: number, to: number) {
		const doc = this.element.ownerDocument;
		const selection = doc.defaultView?.getSelection();
		if (!selection) return;
		const start = this.domPoint(from);
		const end = this.domPoint(to);
		const range = doc.createRange();
		range.setStart(start.node, start.offset);
		range.setEnd(end.node, end.offset);
		selection.removeAllRanges();
		selection.addRange(range);
	}

	applyChange(
		from: number,
		to: number,
		insert: string,
		tabstops: readonly Range[] = [],
		selection?: Range,
	): Range[] {
		this.select(from, to);
		// execCommand rather than a DOM write: undo keeps working, and the
		// reader's own `input` handler is what saves the comment.
		this.element.ownerDocument.execCommand("insertText", false, insert);

		const at = (offsetInInsert: number) => from + offsetInInsert;
		const placed = tabstops.map((ts) => ({ from: at(ts.from), to: at(ts.to) }));

		const caret = selection ?? { from: insert.length, to: insert.length };
		this.select(at(caret.from), at(caret.to));

		return placed;
	}

	replaceRange(from: number, to: number, insert: string) {
		this.applyChange(from, to, insert);
	}

	selectRange(range: Range) {
		// The DOM has moved on since `range` was recorded, so re-walk it.
		const fresh = TextBuffer.forElement(this.element);
		(fresh ?? this).select(range.from, range.to);
	}

	setSelection(from: number, to: number = from) {
		this.select(from, to);
	}

	/** Step out of the equation, past its closing `$`. */
	exitMath(): boolean {
		if (!this.mathBounds) return false;
		this.select(this.mathBounds.outer_end, this.mathBounds.outer_end);
		return true;
	}

	watch(remap: (map: (range: Range) => Range) => void) {
		watchElement(this.element, remap);
	}
}

/* Tabstops here are plain text offsets, so they are kept valid by diffing the
 * text on every input: one changed span between a common prefix and suffix,
 * which is what a keystroke produces. */
const watched = new WeakMap<HTMLElement, string>();

function watchElement(element: HTMLElement, remap: (map: (range: Range) => Range) => void) {
	if (watched.has(element)) {
		watched.set(element, segmentsOf(element).text);
		return;
	}
	watched.set(element, segmentsOf(element).text);

	element.addEventListener("input", () => {
		const before = watched.get(element) ?? "";
		const after = segmentsOf(element).text;
		watched.set(element, after);
		if (before === after) return;

		let prefix = 0;
		while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
		let suffix = 0;
		while (
			suffix < before.length - prefix &&
			suffix < after.length - prefix &&
			before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
		) suffix++;

		const oldEnd = before.length - suffix;
		const newEnd = after.length - suffix;
		const delta = after.length - before.length;

		// A tabstop's start holds still and its end follows the text, so typing
		// into a placeholder grows it.
		const move = (offset: number, bias: -1 | 1) => {
			if (offset <= prefix) return offset;
			if (offset >= oldEnd) return offset + delta;
			return bias < 0 ? prefix : newEnd;
		};
		remap((range) => ({ from: move(range.from, -1), to: move(range.to, 1) }));
	});
}

/** The annotation comment the caret is in, or null. */
export function currentTextBuffer(win: any): TextBuffer | null {
	const active = win.document?.activeElement as HTMLElement | null;
	if (!active || !active.isContentEditable) return null;
	if (!active.closest(EDITABLE_SELECTOR.split(" ")[0]) || !active.matches('[contenteditable="true"]')) return null;
	if (!active.closest(".comment")) return null;
	return TextBuffer.forElement(active);
}
