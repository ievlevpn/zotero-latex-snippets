/* Rendering `$…$` in annotations.
 *
 * KaTeX in `output: "mathml"` mode: Gecko renders MathML natively, so this
 * needs no stylesheet and no fonts. Notes need none of this — Zotero renders
 * their equation nodes itself.
 *
 * Rendering is reversible. The original `$…$` is kept on the element it
 * replaced, because the reader reads the comment back out of the DOM as
 * `innerText` when you edit it, and it must read back what you typed.
 */
import { renderableEquations } from "src/utils/math_bounds";

export const MATH_CLASS = "latex-snippets-math";
const SOURCE_ATTR = "data-latex-snippets-source";

type Katex = { render(tex: string, element: Element, options: object): void };

/** Is anything in here already rendered? */
export function isRendered(root: Element): boolean {
	return !!root.querySelector(`[${SOURCE_ATTR}]`);
}

/** Put the `$…$` back, exactly as it was. */
export function unrenderMath(root: Element): boolean {
	const rendered = root.querySelectorAll(`[${SOURCE_ATTR}]`);
	if (!rendered.length) return false;
	for (const element of Array.from(rendered)) {
		const source = element.getAttribute(SOURCE_ATTR) ?? "";
		element.replaceWith(root.ownerDocument.createTextNode(source));
	}
	root.normalize();
	return true;
}

function textNodesOf(root: Element): Text[] {
	const nodes: Text[] = [];
	const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	let node: Node | null;
	while ((node = walker.nextNode())) nodes.push(node as Text);
	return nodes;
}

/**
 * Render every equation in `root`, in place, leaving surrounding markup alone.
 *
 * ponytail: an equation split across a `<b>` boundary is left as text. Nobody
 * bolds half a formula, and handling it would mean rebuilding the subtree.
 */
export function renderMath(root: Element, katex: Katex): boolean {
	if (isRendered(root)) return false;

	let changed = false;
	for (const node of textNodesOf(root)) {
		const text = node.data;
		const equations = renderableEquations(text);
		if (!equations.length) continue;

		const doc = root.ownerDocument;
		const pieces: Node[] = [];
		let offset = 0;

		for (const bounds of equations) {
			if (bounds.outer_start > offset) {
				pieces.push(doc.createTextNode(text.slice(offset, bounds.outer_start)));
			}
			const span = doc.createElement("span");
			span.className = MATH_CLASS;
			span.setAttribute(SOURCE_ATTR, text.slice(bounds.outer_start, bounds.outer_end));
			// contentEditable=false keeps the caret from wandering inside the
			// MathML if the field is focused before we can put the source back.
			span.contentEditable = "false";
			try {
				katex.render(text.slice(bounds.inner_start, bounds.inner_end), span, {
					output: "mathml",
					throwOnError: false,
					displayMode: bounds.display,
				});
			} catch {
				span.textContent = text.slice(bounds.outer_start, bounds.outer_end);
			}
			pieces.push(span);
			offset = bounds.outer_end;
		}

		if (offset < text.length) pieces.push(doc.createTextNode(text.slice(offset)));
		node.replaceWith(...pieces);
		changed = true;
	}

	return changed;
}
