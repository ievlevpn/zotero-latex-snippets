/* Rendering `$…$` in annotation comments.
 *
 * KaTeX in `output: "mathml"` mode: Gecko renders MathML natively, so this
 * needs no stylesheet and no fonts. Notes need none of it — Zotero renders
 * their equation nodes itself.
 *
 * Rendering is reversible, and has to be. On every keystroke the reader runs
 * its own `clean()` over the live element and then reads the comment back out
 * of it, so anything of ours still in the DOM at that moment would end up in
 * the saved comment. The original `$…$` is therefore kept on the element that
 * replaced it, and put back before the reader ever looks.
 */
import { MathBounds, renderableEquations } from "src/utils/math_bounds";
import { segmentsOf, SOURCE_ATTR } from "./segments";

export const MATH_CLASS = "latex-snippets-math";

type Katex = { render(tex: string, element: Element, options: object): void };

export function isRendered(root: Element): boolean {
	return !!root.querySelector(`[${SOURCE_ATTR}]`);
}

/** Put every `$…$` back, exactly as it was. */
export function unrenderMath(root: Element): boolean {
	const rendered = root.querySelectorAll(`[${SOURCE_ATTR}]`);
	if (!rendered.length) return false;
	for (const element of Array.from(rendered)) {
		element.replaceWith(root.ownerDocument.createTextNode(element.getAttribute(SOURCE_ATTR) ?? ""));
	}
	root.normalize();
	return true;
}

function build(doc: Document, text: string, bounds: MathBounds, katex: Katex): Element {
	const source = text.slice(bounds.outer_start, bounds.outer_end);
	const span = doc.createElement("span");
	span.className = MATH_CLASS;
	span.setAttribute(SOURCE_ATTR, source);
	// The caret must not be able to get inside the MathML: everything upstream
	// treats a rendered equation as one atom the width of its source.
	span.contentEditable = "false";
	try {
		katex.render(text.slice(bounds.inner_start, bounds.inner_end), span, {
			output: "mathml",
			throwOnError: false,
			displayMode: bounds.display,
		});
	} catch {
		span.textContent = source;
	}
	return span;
}

/**
 * Render the equations in `root`, in place, leaving surrounding markup alone.
 *
 * `caret`, when given, is a text offset whose equation is left as source — that
 * is the one being edited, and replacing it under the cursor would be no use to
 * anybody.
 *
 * ponytail: an equation split across a `<b>` boundary is left as text. Nobody
 * bolds half a formula, and handling it would mean rebuilding the subtree.
 */
export function renderMath(root: Element, katex: Katex, caret?: number | null): boolean {
	unrenderMath(root);

	const { segments, text } = segmentsOf(root);
	const equations = renderableEquations(text).filter(
		(bounds) => caret == null || caret < bounds.outer_start || caret > bounds.outer_end,
	);
	if (!equations.length) return false;

	const doc = root.ownerDocument;
	let changed = false;

	// Back to front, so replacing one equation cannot shift the next one's node.
	for (const segment of [...segments].reverse()) {
		if (segment.kind !== "text") continue;
		const node = segment.node as Text;
		const within = equations.filter(
			(bounds) => bounds.outer_start >= segment.start && bounds.outer_end <= segment.start + segment.length,
		);
		if (!within.length) continue;

		const pieces: Node[] = [];
		let offset = segment.start;
		for (const bounds of within) {
			if (bounds.outer_start > offset) pieces.push(doc.createTextNode(text.slice(offset, bounds.outer_start)));
			pieces.push(build(doc, text, bounds, katex));
			offset = bounds.outer_end;
		}
		const tail = segment.start + segment.length;
		if (offset < tail) pieces.push(doc.createTextNode(text.slice(offset, tail)));

		node.replaceWith(...pieces);
		changed = true;
	}

	return changed;
}
