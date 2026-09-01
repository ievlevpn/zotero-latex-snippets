/* Showing where the tabstops are.
 *
 * CodeMirror marks them with decorations; neither editor here has an equivalent
 * we can reach — ProseMirror's Decoration classes are not importable from
 * inside the note editor, and an annotation comment is a plain contenteditable.
 * So the marks are drawn *over* the text instead of in it, which has the
 * happy property of never touching the document: nothing to strip before Zotero
 * reads a comment back, and nothing to undo.
 */
const LAYER_ID = "latex-snippets-tabstops";

const STYLE = `
#${LAYER_ID} { position: fixed; inset: 0; pointer-events: none; z-index: 2147483000; }
#${LAYER_ID} > i {
	position: fixed;
	background: color-mix(in srgb, Highlight 22%, transparent);
	border-bottom: 1px solid color-mix(in srgb, Highlight 55%, transparent);
	border-radius: 2px;
}
`;

function layerFor(doc: Document): HTMLElement {
	let layer = doc.getElementById(LAYER_ID);
	if (layer) return layer as HTMLElement;

	const style = doc.createElement("style");
	style.textContent = STYLE;
	doc.head?.appendChild(style);

	layer = doc.createElement("div");
	layer.id = LAYER_ID;
	doc.body.appendChild(layer);
	return layer as HTMLElement;
}

/** Draw a mark over each rectangle, replacing whatever was there. */
export function showTabstopMarks(doc: Document, rects: DOMRect[]) {
	const layer = layerFor(doc);
	layer.replaceChildren();
	for (const rect of rects) {
		if (rect.width <= 0 && rect.height <= 0) continue;
		const mark = doc.createElement("i");
		mark.style.left = `${rect.left}px`;
		mark.style.top = `${rect.top}px`;
		// A tabstop with no placeholder is a caret position, not a span; give it
		// enough width to be visible at all.
		mark.style.width = `${Math.max(rect.width, 2)}px`;
		mark.style.height = `${rect.height}px`;
		layer.appendChild(mark);
	}
}

export function hideTabstopMarks(doc: Document | null | undefined) {
	doc?.getElementById(LAYER_ID)?.replaceChildren();
}
