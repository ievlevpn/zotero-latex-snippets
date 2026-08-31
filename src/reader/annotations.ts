/* Live rendering of `$…$` in the reader's annotation comments.
 *
 * The constraint that shapes all of this: on every input the reader runs its
 * own `clean()` over the live comment element and then reads the comment back
 * out of it. Anything of ours still in the DOM at that moment would be saved
 * into the annotation. So the rendering comes out synchronously on `input` in
 * the capture phase — React attaches its handler at the root container, so ours
 * runs first — and goes straight back in on the way out, in the bubble phase of
 * the same event. Both happen in one task, before the browser paints, so
 * nothing flickers; and rendered equations are cached by source, so putting
 * them back costs a clone rather than a trip through KaTeX.
 *
 * While a comment is focused, the equation the caret is inside stays as source,
 * so it can be edited; the rest of the comment renders around it. A rendered
 * equation is `contenteditable=false`, so the caret cannot be placed inside one
 * — clicking it has to put the source back and drop the caret in, or an
 * equation would become uneditable the moment it rendered.
 */
import { renderMath, unrenderMath } from "src/render/math";
import { segmentsOf, selectionOffsets, setCaret, SOURCE_ATTR } from "src/render/segments";
import { renderableEquations } from "src/utils/math_bounds";
import { COMMENT_FIELD } from "src/editor/contenteditable";

/** Long enough for a burst of React updates to settle, short enough not to be felt. */
const SETTLE_MS = 100;

const STATE_ATTR = "data-latex-snippets-render";

export function installAnnotationRendering(win: any): () => void {
	const doc: Document = win.document;
	const katex = win.katex;
	if (!katex) {
		console.warn("latex-snippets: KaTeX did not load; annotations will not render math");
		return () => {};
	}

	const fields = () => Array.from(doc.querySelectorAll(COMMENT_FIELD)) as HTMLElement[];
	const fieldOf = (node: unknown) => (node as HTMLElement)?.closest?.(COMMENT_FIELD) as HTMLElement | null;
	const isFocused = (field: HTMLElement) => field === doc.activeElement || field.contains(doc.activeElement);

	function renderField(field: HTMLElement) {
		const selection = isFocused(field) ? selectionOffsets(field) : null;
		const caret = selection ? selection.to : null;

		// Rendering mutates the DOM, which wakes the observer, which would render
		// again: skip when the DOM already says what it should.
		const { text } = segmentsOf(field);
		const wanted = renderableEquations(text)
			.filter((bounds) => caret == null || caret < bounds.outer_start || caret > bounds.outer_end)
			.map((bounds) => `${bounds.outer_start}:${bounds.outer_end}`)
			.join(",");
		if (field.getAttribute(STATE_ATTR) === wanted) return;

		const changed = renderMath(field, katex, caret);
		field.setAttribute(STATE_ATTR, wanted);
		// Only when the DOM actually moved: the caret is fine otherwise, and
		// resetting it on every keystroke is exactly what makes typing feel laggy.
		if (changed && selection) setCaret(field, selection.from, selection.to);
	}

	let timer = 0;
	const schedule = (delay: number) => {
		win.clearTimeout(timer);
		timer = win.setTimeout(() => {
			timer = 0;
			for (const field of fields()) renderField(field);
		}, delay);
	};

	/* Capture phase, so this runs before React's onInput — which is attached at
	 * the root container and would otherwise read our MathML back as the comment. */
	const onInputCapture = (event: Event) => {
		const field = fieldOf(event.target);
		if (!field) return;
		const selection = selectionOffsets(field);
		if (unrenderMath(field) && selection) setCaret(field, selection.from, selection.to);
		field.removeAttribute(STATE_ATTR);
	};

	/* Bubble phase of the same event: React has read the comment by now, so the
	 * equations can go back. Same task, so there is no paint in between and the
	 * comment never visibly drops to source. */
	const onInputBubble = (event: Event) => {
		const field = fieldOf(event.target);
		if (!field) return;
		// Rewriting the DOM mid-composition would abort the IME; wait it out.
		if ((event as InputEvent).isComposing) return;
		renderField(field);
	};

	const onCompositionEnd = () => schedule(0);

	/* Click a rendered equation to edit it. Without this an equation becomes
	 * read-only as soon as it renders: it is an atom, so the caret cannot enter
	 * it, and no snippet can ever see math mode there again. */
	const onMouseDown = (event: MouseEvent) => {
		const span = (event.target as HTMLElement)?.closest?.(`[${SOURCE_ATTR}]`) as HTMLElement | null;
		if (!span) return;
		const field = fieldOf(span);
		if (!field || !field.isContentEditable) return;

		const { segments } = segmentsOf(field);
		const segment = segments.find((s) => s.node === span);
		const source = span.getAttribute(SOURCE_ATTR) ?? "";
		const delimiter = source.startsWith("$$") ? 2 : 1;

		event.preventDefault();
		field.focus();
		unrenderMath(field);
		field.removeAttribute(STATE_ATTR);
		// Just inside the closing delimiter, which is where you want to be when
		// you click an equation to change it.
		setCaret(field, (segment?.start ?? 0) + source.length - delimiter);
		schedule(SETTLE_MS);
	};

	const onFocusChange = () => schedule(0);
	// The caret leaving an equation is what lets it render again.
	const onSelectionChange = () => {
		if (fieldOf(doc.activeElement)) schedule(SETTLE_MS);
	};

	doc.addEventListener("input", onInputCapture, true);
	doc.addEventListener("input", onInputBubble, false);
	doc.addEventListener("compositionend", onCompositionEnd, true);
	doc.addEventListener("mousedown", onMouseDown, true);
	doc.addEventListener("focusin", onFocusChange, true);
	doc.addEventListener("focusout", onFocusChange, true);
	doc.addEventListener("selectionchange", onSelectionChange);

	// React rewrites these fields whenever an annotation changes, wiping what we
	// rendered; watching the document is simpler than tracking its lifecycles.
	const observer = new win.MutationObserver(() => schedule(SETTLE_MS));
	observer.observe(doc.body, { childList: true, subtree: true, characterData: true });
	schedule(0);

	return () => {
		observer.disconnect();
		win.clearTimeout(timer);
		doc.removeEventListener("input", onInputCapture, true);
		doc.removeEventListener("input", onInputBubble, false);
		doc.removeEventListener("compositionend", onCompositionEnd, true);
		doc.removeEventListener("mousedown", onMouseDown, true);
		doc.removeEventListener("focusin", onFocusChange, true);
		doc.removeEventListener("focusout", onFocusChange, true);
		doc.removeEventListener("selectionchange", onSelectionChange);
		for (const field of fields()) {
			unrenderMath(field);
			field.removeAttribute(STATE_ATTR);
		}
	};
}
