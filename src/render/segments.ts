/* One offset model for an annotation comment, shared by the renderer and the
 * snippet engine.
 *
 * A comment is flat text, but its DOM is not: it may hold `<b>`/`<i>` runs,
 * `<br>` line breaks, and — once rendered — spans of MathML standing in for
 * `$…$`. A rendered equation counts as its *source* length, so the offsets here
 * always describe the comment as Zotero stores it, rendered or not.
 */
export const SOURCE_ATTR = "data-latex-snippets-source";

export type Segment = {
	kind: "text" | "br" | "math";
	start: number;
	length: number;
	node: Node;
};

export function segmentsOf(root: Node): { segments: Segment[]; text: string } {
	const segments: Segment[] = [];
	let text = "";

	const walk = (parent: Node) => {
		for (const child of Array.from(parent.childNodes)) {
			if (child.nodeType === 3) {
				const value = (child as Text).data;
				segments.push({ kind: "text", start: text.length, length: value.length, node: child });
				text += value;
				continue;
			}
			if (child.nodeType !== 1) continue;

			const element = child as Element;
			if (element.nodeName === "BR") {
				segments.push({ kind: "br", start: text.length, length: 1, node: element });
				text += "\n";
			} else if (element.hasAttribute(SOURCE_ATTR)) {
				const source = element.getAttribute(SOURCE_ATTR) ?? "";
				segments.push({ kind: "math", start: text.length, length: source.length, node: element });
				text += source;
			} else {
				walk(element);
			}
		}
	};
	walk(root);

	return { segments, text };
}

/** Text offset -> a DOM point. Rendered equations are atomic: before, or after. */
export function domPointAt(root: Element, segments: Segment[], offset: number): { node: Node; offset: number } {
	for (const segment of segments) {
		if (offset > segment.start + segment.length) continue;
		if (segment.kind === "text") return { node: segment.node, offset: offset - segment.start };
		const parent = segment.node.parentNode!;
		const index = Array.prototype.indexOf.call(parent.childNodes, segment.node);
		return { node: parent, offset: offset === segment.start ? index : index + 1 };
	}
	return { node: root, offset: root.childNodes.length };
}

/** A DOM point -> a text offset, by measuring everything before it. */
export function offsetOfPoint(root: Element, container: Node, offset: number): number {
	const measure = root.ownerDocument.createRange();
	measure.selectNodeContents(root);
	measure.setEnd(container, offset);
	return segmentsOf(measure.cloneContents()).text.length;
}

/** The selection within `root`, in text offsets, or null if it is elsewhere. */
export function selectionOffsets(root: Element): { from: number; to: number } | null {
	const selection = root.ownerDocument.defaultView?.getSelection();
	if (!selection || selection.rangeCount === 0) return null;
	const range = selection.getRangeAt(0);
	if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
	return {
		from: offsetOfPoint(root, range.startContainer, range.startOffset),
		to: offsetOfPoint(root, range.endContainer, range.endOffset),
	};
}

export function setCaret(root: Element, from: number, to: number = from) {
	const doc = root.ownerDocument;
	const selection = doc.defaultView?.getSelection();
	if (!selection) return;
	const { segments } = segmentsOf(root);
	const start = domPointAt(root, segments, from);
	const end = domPointAt(root, segments, to);
	const range = doc.createRange();
	range.setStart(start.node, start.offset);
	range.setEnd(end.node, end.offset);
	selection.removeAllRanges();
	selection.addRange(range);
}
