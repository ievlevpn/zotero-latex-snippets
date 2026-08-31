/* Editor-layer checks: the ProseMirror side, driven headlessly.
 *
 * The schema mirrors the parts of Zotero's note schema the engine touches (see
 * notes/zotero-note-editor.md): math nodes are atoms whose content is unmarked
 * text, edited in a nested view whose doc *is* the math node; and an inline
 * equation inside a paragraph is one character of text but several ProseMirror
 * positions.
 *
 * Only the DOM lookup in getActiveMathView needs a real note editor, and it is
 * three property reads, so it is faked here and everything else is the real code.
 */
import assert from "node:assert";
import { Schema } from "prosemirror-model";
import { EditorState, TextSelection } from "prosemirror-state";
import * as ls from "./build/test-exports.mjs";

const schema = new Schema({
	nodes: {
		doc: { content: "block+" },
		paragraph: { group: "block", content: "(text | hardBreak | math_inline)*", toDOM: () => ["p", 0] },
		math_display: { group: "block math", content: "text*", atom: true, code: true, toDOM: () => ["pre", 0] },
		math_inline: { group: "inline math", content: "text*", marks: "", inline: true, atom: true, toDOM: () => ["span", 0] },
		hardBreak: { inline: true, group: "inline", selectable: false, toDOM: () => ["br"] },
		text: { group: "inline" },
	},
	marks: { strong: { toDOM: () => ["strong", 0], parseDOM: [{ tag: "strong" }] } },
});

/** A stand-in for EditorView: Buffer only ever uses state, schema and dispatch. */
function viewOf(doc, from, to = from) {
	const view = {
		state: EditorState.create({ doc, schema }),
		dispatch(tr) { view.state = view.state.apply(tr); },
	};
	view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
	ls.rememberSelectionClass(view);
	return view;
}

/** The nested view prosemirror-math opens on an equation. */
function mathView(text, cursor = text.length, type = "math_inline") {
	return viewOf(schema.nodes[type].create(null, text ? schema.text(text) : null), cursor);
}

/** A window whose activeElement sits inside that equation, as Zotero's would. */
function winFor(view, type = "math_inline") {
	const el = { tagName: type.replace("_", "-").toUpperCase(), pmViewDesc: { spec: { _innerView: view } } };
	return { document: { activeElement: { closest: (sel) => (sel === ".math-node" ? el : null) } } };
}

const settingsFor = (source) =>
	ls.processSettings({ ...ls.DEFAULT_SETTINGS, snippets: source, snippetVariables: "export default {}" });

const automatic = (settings) => settings.snippets.filter((s) => s.options.automatic);
const text = (view) => view.state.doc.textContent;
const cursor = (view) => [view.state.selection.from, view.state.selection.to];

/* A Buffer over a plain string, standing in for an annotation comment.
 * The reader's real backend adds only DOM plumbing on top of this contract:
 * offsets into flat text, and edits that replace a range. */
class StringBuffer {
	constructor(text, from = text.length, to = from) {
		this.text = text;
		this.from = from;
		this.to = to;
		this.owner = { annotation: true };
		this.edits = [];
	}
	get mathBounds() { return ls.mathBoundsAt(this.text, this.to); }
	get kind() { return this.mathBounds ? (this.mathBounds.display ? "math_display" : "math_inline") : "text"; }
	get inMath() { return this.mathBounds !== null; }
	get selectedText() { return this.text.slice(this.from, this.to); }
	get dollarMath() { return true; }
	applyChange(from, to, insert, tabstops = [], selection) {
		this.text = this.text.slice(0, from) + insert + this.text.slice(to);
		const caret = selection ?? { from: insert.length, to: insert.length };
		this.from = from + caret.from;
		this.to = from + caret.to;
		return tabstops.map((ts) => ({ from: from + ts.from, to: from + ts.to }));
	}
	replaceRange(from, to, insert) { this.applyChange(from, to, insert); }
	selectRange(range) { this.from = range.from; this.to = range.to; }
	setSelection(from, to = from) { this.from = from; this.to = to; }
	exitMath() {
		if (!this.mathBounds) return false;
		this.from = this.to = this.mathBounds.outer_end;
		return true;
	}
	watch() {}
}

export function run() {
	/* --- the reported bug: "@a" must consume the "@" *and* the typed "a" --- */
	{
		const settings = settingsFor(`export default [{trigger: "@a", replacement: "\\\\alpha", options: "mA"}]`);
		const view = mathView("@");
		const expanded = ls.runSnippets(winFor(view), { snippets: automatic(settings), key: "a" }, settings);
		assert.strictEqual(expanded, true, "@a should expand");
		assert.strictEqual(text(view), "\\alpha", `@ + a gave ${JSON.stringify(text(view))}`);
		assert.deepStrictEqual(cursor(view), [6, 6]);
	}

	/* --- and in the middle of an expression --- */
	{
		const settings = settingsFor(`export default [{trigger: "@a", replacement: "\\\\alpha", options: "mA"}]`);
		const view = mathView("x + @", 5);
		ls.runSnippets(winFor(view), { snippets: automatic(settings), key: "a" }, settings);
		assert.strictEqual(text(view), "x + \\alpha");
	}

	/* --- tabstops: first one selected, Tab walks the rest --- */
	{
		const settings = settingsFor(`export default [{trigger: "//", replacement: "\\\\frac{$0}{$1}$2", options: "mA"}]`);
		const view = mathView("/");
		ls.runSnippets(winFor(view), { snippets: automatic(settings), key: "/" }, settings);
		assert.strictEqual(text(view), "\\frac{}{}");
		assert.deepStrictEqual(cursor(view), [6, 6], "cursor should be in the numerator");
		assert.strictEqual(ls.setSelectionToNextTabstop(ls.PMBuffer.forMath(view, "math_inline"), false), true);
		assert.deepStrictEqual(cursor(view), [8, 8], "Tab should reach the denominator");
		assert.strictEqual(ls.setSelectionToNextTabstop(ls.PMBuffer.forMath(view, "math_inline"), false), true);
		assert.deepStrictEqual(cursor(view), [9, 9], "Tab should reach the end");
		assert.strictEqual(ls.setSelectionToNextTabstop(ls.PMBuffer.forMath(view, "math_inline"), false), false, "no tabstops left");
		ls.clearTabstops();
	}

	/* --- placeholders are selected, and typing into one keeps the later ones valid --- */
	{
		const settings = settingsFor(
			`export default [{trigger: "dint", replacement: "\\\\int_{\${0:0}}^{\${1:\\\\infty}} $2", options: "mA"}]`);
		const view = mathView("din");
		ls.runSnippets(winFor(view), { snippets: automatic(settings), key: "t" }, settings);
		// the trailing space is trimmed in inline math (removeSnippetWhitespace)
		assert.strictEqual(text(view), "\\int_{0}^{\\infty}");
		assert.deepStrictEqual(cursor(view), [6, 7], "the \"0\" placeholder should be selected");

		// Replace the placeholder with something longer; the next tabstop must follow.
		view.dispatch(view.state.tr.insertText("2\\pi", 6, 7));
		assert.strictEqual(text(view), "\\int_{2\\pi}^{\\infty}");
		assert.strictEqual(ls.setSelectionToNextTabstop(ls.PMBuffer.forMath(view, "math_inline"), false), true);
		const [from, to] = cursor(view);
		assert.strictEqual(text(view).slice(from, to), "\\infty", "second placeholder should have moved with the edit");
		ls.clearTabstops();
	}

	/* --- word boundary --- */
	{
		const settings = settingsFor(`export default [{trigger: "dm", replacement: "X", options: "mAw"}]`);
		const glued = mathView("xd");
		assert.strictEqual(
			ls.runSnippets(winFor(glued), { snippets: automatic(settings), key: "m" }, settings), false,
			"\"xdm\" is not on a word boundary");
		const free = mathView("x d");
		assert.strictEqual(ls.runSnippets(winFor(free), { snippets: automatic(settings), key: "m" }, settings), true);
		assert.strictEqual(text(free), "x X");
	}

	/* --- visual snippets wrap the selection --- */
	{
		const settings = settingsFor(
			`export default [{trigger: "U", replacement: "\\\\underbrace{ \${VISUAL} }_{ $0 }", options: "mA"}]`);
		const view = mathView("a+b", 0);
		view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 0, 3)));
		ls.runSnippets(winFor(view), { snippets: automatic(settings), key: "U" }, settings);
		assert.strictEqual(text(view), "\\underbrace{ a+b }_{  }");
		ls.clearTabstops();
	}

	/* --- regex snippets replace only what they matched --- */
	{
		const settings = settingsFor(
			`export default [{trigger: /([A-Za-z])(\\d)/, replacement: "[[0]]_{[[1]]}", options: "mA"}]`);
		const view = mathView("1 + x");
		ls.runSnippets(winFor(view), { snippets: automatic(settings), key: "2" }, settings);
		assert.strictEqual(text(view), "1 + x_{2}");
	}

	/* --- mode gating: a text-mode snippet must not fire inside an equation --- */
	{
		const settings = settingsFor(`export default [{trigger: "@a", replacement: "NOPE", options: "tA"}]`);
		const view = mathView("@");
		assert.strictEqual(ls.runSnippets(winFor(view), { snippets: automatic(settings), key: "a" }, settings), false);
		assert.strictEqual(text(view), "@");
	}

	/* --- ...and \text{} inside math counts as text --- */
	{
		const settings = settingsFor(`export default [
			{trigger: "@a", replacement: "\\\\alpha", options: "mA"},
			{trigger: "@a", replacement: "TEXT", options: "TA"},
		]`);
		const view = mathView("\\text{@");
		ls.runSnippets(winFor(view), { snippets: automatic(settings), key: "a" }, settings);
		assert.strictEqual(text(view), "\\text{TEXT");
	}

	/* --- display math is a separate mode --- */
	{
		const settings = settingsFor(`export default [
			{trigger: "xx", replacement: "BLOCK", options: "MA"},
			{trigger: "xx", replacement: "INLINE", options: "nA"},
		]`);
		const inline = mathView("x");
		ls.runSnippets(winFor(inline), { snippets: automatic(settings), key: "x" }, settings);
		assert.strictEqual(text(inline), "INLINE");

		const block = mathView("x", 1, "math_display");
		ls.runSnippets(winFor(block, "math_display"), { snippets: automatic(settings), key: "x" }, settings);
		assert.strictEqual(text(block), "BLOCK");
	}

	/* --- auto-fraction --- */
	{
		const settings = settingsFor("export default []");
		const view = mathView("1 + (a+b)");
		assert.strictEqual(ls.runAutoFraction(winFor(view), settings), true);
		assert.strictEqual(text(view), "1 + \\frac{a+b}{}");
		ls.clearTabstops();
	}

	/* --- a text block: offsets and positions differ around an inline equation --- */
	{
		const doc = schema.nodes.doc.create(null, schema.nodes.paragraph.create(null, [
			schema.text("ab"),
			schema.nodes.math_inline.create(null, schema.text("x^2")),
			schema.text("cd"),
		]));
		// cursor at the very end of the paragraph
		const end = doc.content.size - 1;
		const view = viewOf(doc, end);
		const buffer = ls.PMBuffer.forTextBlock(view);
		assert.strictEqual(buffer.text, "ab￼cd", "an inline equation counts as one character");
		assert.strictEqual(buffer.to, 5);

		// text offset -> position -> text offset round-trips on both sides of the atom
		for (const offset of [0, 1, 2, 3, 4, 5]) {
			assert.strictEqual(buffer.textOffset(buffer.pmPos(offset)), offset, `offset ${offset} round-trip`);
		}
		// the atom is 5 positions wide (open + 3 chars + close), one character wide
		assert.strictEqual(buffer.pmPos(3) - buffer.pmPos(2), 5);

		// a replacement after the atom lands where it should
		buffer.applyChange(3, 5, "CD");
		assert.strictEqual(view.state.doc.firstChild.textContent, "abx^2CD");
	}

	/* --- marks are carried into a text-mode replacement --- */
	{
		const bold = schema.marks.strong.create();
		const doc = schema.nodes.doc.create(null,
			schema.nodes.paragraph.create(null, [schema.text("hi", [bold])]));
		const view = viewOf(doc, 3);
		const buffer = ls.PMBuffer.forTextBlock(view);
		buffer.applyChange(2, 2, "!");
		assert.deepStrictEqual(view.state.doc.firstChild.child(0).marks.map((m) => m.type.name), ["strong"]);
		assert.strictEqual(view.state.doc.firstChild.childCount, 1, "the inserted text should join the bold run");
	}

	/* --- \n in a paragraph becomes a hard break, not a stray character --- */
	{
		const doc = schema.nodes.doc.create(null, schema.nodes.paragraph.create(null, schema.text("a")));
		const view = viewOf(doc, 2);
		ls.PMBuffer.forTextBlock(view).applyChange(1, 1, "x\ny");
		const p = view.state.doc.firstChild;
		assert.deepStrictEqual(
			[...Array(p.childCount)].map((_, i) => p.child(i).type.name),
			["text", "hardBreak", "text"],
		);
	}

	/* --- annotations: math mode comes from the `$` delimiters --- */
	{
		const inside = new StringBuffer("note $x + @", 11);
		assert.strictEqual(ls.Context.fromBuffer(inside).mode.inlineMath, true, "inside $…$ is inline math");
		const outside = new StringBuffer("just a note", 11);
		assert.strictEqual(ls.Context.fromBuffer(outside).mode.text, true, "prose is text mode");
		const block = new StringBuffer("$$ x + @", 8);
		assert.strictEqual(ls.Context.fromBuffer(block).mode.blockMath, true, "inside $$…$$ is block math");

		// scopes are scanned from the start of the equation, not of the comment
		const inText = new StringBuffer("prose $a \\text{@");
		const ctx = ls.Context.fromBuffer(inText);
		assert.deepStrictEqual(ctx.getEnvNames().map((x) => x.name), ["text"]);
		assert.strictEqual(ctx.mode.textEnv, true);
	}

	/* --- and a snippet expands there, tabstops and all --- */
	{
		const buffer = new StringBuffer("see $\\frac{a}{b} din", 20);
		const settings = settingsFor(
			`export default [{trigger: "dint", replacement: "\\\\int_{\${0:0}}^{\${1:\\\\infty}}", options: "mA"}]`);
		const snippet = settings.snippets.filter((s) => s.options.automatic)[0];
		const ctx = ls.Context.fromBuffer(buffer);
		assert.strictEqual(snippet.options.snippetShouldRunInMode(ctx.mode), true);

		const result = snippet.process({
			effectiveLine: buffer.text.slice(0, buffer.to) + "t",
			range: { from: buffer.from, to: buffer.to },
			sel: "", effectiveLineAfter: () => "", api: {},
		});
		ls.expandSnippet(buffer, result.triggerPos, buffer.to, result.replacement);
		assert.strictEqual(buffer.text, "see $\\frac{a}{b} \\int_{0}^{\\infty}");
		assert.strictEqual(buffer.text.slice(buffer.from, buffer.to), "0", "the 0 placeholder is selected");
		assert.strictEqual(ls.setSelectionToNextTabstop(buffer, false), true);
		assert.strictEqual(buffer.text.slice(buffer.from, buffer.to), "\\infty");
		ls.clearTabstops();
	}

	/* --- leaving an equation means stepping past its closing $ --- */
	{
		const buffer = new StringBuffer("a $x^2$ b", 6);
		assert.strictEqual(buffer.exitMath(), true);
		assert.strictEqual(buffer.from, 7, "cursor lands after the closing dollar");
	}

	console.log("editor-layer tests passed");
}
