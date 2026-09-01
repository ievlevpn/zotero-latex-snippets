/* The contenteditable layer, against a real DOM.
 *
 * Every bug in this plugin so far has been here — offsets, ranges, and what
 * survives a render/unrender round trip — and none of it was reachable from the
 * other suites. jsdom has no layout, so anything measuring rectangles is out of
 * scope; everything structural is not.
 */
import assert from "node:assert";
import { JSDOM } from "jsdom";
import * as ls from "./build/test-exports.mjs";

/** Stands in for KaTeX: enough to tell rendered output from source. */
const katex = { render: (tex, element) => { element.textContent = `«${tex}»`; } };

function field(html) {
	const dom = new JSDOM(`<body><div class="comment"><div class="content" contenteditable="true">${html}</div></div></body>`);
	const el = dom.window.document.querySelector(".content");
	return { dom, el, window: dom.window };
}

export function run() {
	/* --- the text model --- */
	{
		const { el } = field("abc $x$ def");
		assert.strictEqual(ls.segmentsOf(el).text, "abc $x$ def");

		const withBreak = field("a<br>b").el;
		assert.strictEqual(ls.segmentsOf(withBreak).text, "a\nb", "a <br> is one character");

		const withMarkup = field("a<b>bc</b>d").el;
		assert.strictEqual(ls.segmentsOf(withMarkup).text, "abcd", "markup is transparent to the text model");
	}

	/* --- offsets round-trip at every position, before and after an equation --- */
	{
		const { el } = field("abc $x$ def");
		ls.renderMath(el, katex);

		const { segments, text } = ls.segmentsOf(el);
		assert.strictEqual(text, "abc $x$ def", "a rendered equation still reads as its source");

		// Offsets outside the equation round-trip exactly. Ones inside it cannot:
		// it is an atom, so they snap to the nearer side — 4 and 7 here.
		const snapped = { 5: 4, 6: 7 };
		for (let offset = 0; offset <= text.length; offset++) {
			const point = ls.domPointAt(el, segments, offset);
			assert.ok(point.node, `offset ${offset} has a DOM point`);
			assert.strictEqual(
				ls.offsetOfPoint(el, point.node, point.offset),
				snapped[offset] ?? offset,
				`offset ${offset} maps as expected`,
			);
		}
	}

	/* --- rendering, and putting it back exactly --- */
	{
		const { el } = field("abc $x$ def");
		assert.strictEqual(ls.renderMath(el, katex), true);
		assert.strictEqual(el.querySelectorAll("[data-latex-suite-source]").length, 1);
		assert.strictEqual(el.textContent, "abc «x» def", "the equation shows rendered");

		assert.strictEqual(ls.unrenderMath(el), true);
		assert.strictEqual(el.innerHTML, "abc $x$ def", "and comes back byte for byte");
	}

	/* --- an equation spanning inline markup keeps that markup --- */
	{
		const { el } = field("say $a<b>x</b>b$ ok");
		assert.strictEqual(ls.segmentsOf(el).text, "say $axb$ ok");
		ls.renderMath(el, katex);
		assert.strictEqual(el.querySelectorAll("[data-latex-suite-source]").length, 1, "it renders");

		ls.unrenderMath(el);
		assert.strictEqual(el.innerHTML, "say $a<b>x</b>b$ ok", "the <b> survives the round trip");
	}

	/* --- text either side of an equation behaves the same --- */
	{
		const { el } = field("abc $x$ def");
		ls.renderMath(el, katex);
		const { segments } = ls.segmentsOf(el);

		const before = ls.domPointAt(el, segments, 2);   // inside "abc"
		const after = ls.domPointAt(el, segments, 9);    // inside "def"
		assert.strictEqual(before.node.nodeType, 3, "before the equation is a text node");
		assert.strictEqual(after.node.nodeType, 3, "after the equation is a text node");
		assert.strictEqual(ls.offsetOfPoint(el, before.node, before.offset), 2);
		assert.strictEqual(ls.offsetOfPoint(el, after.node, after.offset), 9);

		// the boundaries either side of the atom
		const justBefore = ls.domPointAt(el, segments, 4);
		const justAfter = ls.domPointAt(el, segments, 7);
		assert.strictEqual(ls.offsetOfPoint(el, justBefore.node, justBefore.offset), 4, "boundary before the equation");
		assert.strictEqual(ls.offsetOfPoint(el, justAfter.node, justAfter.offset), 7, "boundary after the equation");
	}

	/* --- the caret's own equation is left as source, on either side --- */
	{
		const text = "abc $x$ def";
		const rendered = (caret) => {
			const { el } = field(text);
			ls.renderMath(el, katex, caret);
			return el.querySelectorAll("[data-latex-suite-source]").length;
		};
		assert.strictEqual(rendered(2), 1, "caret well before: renders");
		assert.strictEqual(rendered(9), 1, "caret well after: renders");
		assert.strictEqual(rendered(5), 0, "caret inside: stays source");
		assert.strictEqual(rendered(4), 0, "caret at the opening delimiter: stays source");
		assert.strictEqual(rendered(7), 0, "caret at the closing delimiter: stays source");
	}

	console.log("dom-layer tests passed");
}
