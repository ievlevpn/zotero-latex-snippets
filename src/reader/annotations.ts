/* Rendering equations in the reader's annotation comments.
 *
 * The comment field is a contenteditable that Zotero reads back as `innerText`
 * when you edit it, so the `$…$` has to be there whenever the field is focused.
 * Hence: put the source back synchronously on focus, and re-render a frame
 * later, once React's own blur handling has run and read the value it wanted.
 */
import { renderMath, unrenderMath } from "src/render/math";

/** Comments only — the other field holds the passage quoted from the document. */
const FIELD = ".annotation .comment .content";

export function installAnnotationRendering(win: any): () => void {
	const doc: Document = win.document;
	const katex = win.katex;
	if (!katex) {
		console.warn("latex-snippets: KaTeX did not load; annotations will not render math");
		return () => {};
	}

	const onFocusIn = (event: Event) => {
		const field = (event.target as HTMLElement)?.closest?.(FIELD);
		if (field) unrenderMath(field);
	};

	let scheduled = 0;
	const tick = () => {
		scheduled = 0;
		for (const field of Array.from(doc.querySelectorAll(FIELD))) {
			if (field === doc.activeElement || field.contains(doc.activeElement)) continue;
			renderMath(field, katex);
		}
	};
	const schedule = () => {
		if (!scheduled) scheduled = win.requestAnimationFrame(tick);
	};

	doc.addEventListener("focusin", onFocusIn, true);
	doc.addEventListener("focusout", schedule, true);

	// React rewrites these fields whenever the annotation changes, wiping what we
	// rendered; watching the document is simpler than tracking its lifecycles.
	const observer = new win.MutationObserver(schedule);
	observer.observe(doc.body, { childList: true, subtree: true, characterData: true });
	schedule();

	return () => {
		observer.disconnect();
		if (scheduled) win.cancelAnimationFrame(scheduled);
		doc.removeEventListener("focusin", onFocusIn, true);
		doc.removeEventListener("focusout", schedule, true);
		for (const field of Array.from(doc.querySelectorAll(FIELD))) unrenderMath(field);
	};
}
