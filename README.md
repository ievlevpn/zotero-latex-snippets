# LaTeX Snippets for Zotero

Type LaTeX in Zotero notes as fast as you can write it. This is a port of the
snippets half of [Obsidian Latex Suite](https://github.com/artisticat1/obsidian-latex-suite)
to Zotero's note editor, using **the same snippet format** — you can paste your
existing `latex-suite-snippets.js` straight in.

```
mk          →  inline equation
dm          →  display equation
x/y  Tab    →  \frac{x}{y}
@t          →  \theta
sqx         →  \sqrt{x}
dint Tab 2pi Tab sin @t Tab @t Tab  →  \int_{0}^{2\pi} \sin \theta \, d\theta
```

Ships with Latex Suite's [default snippets](src/default_snippets.js) — 220-odd
of them. Edit, remove, or add your own in **Settings → LaTeX Snippets**.

## Install

Download `latex-snippets.xpi` from the
[latest release](https://github.com/ievlevpn/zotero-latex-snippets/releases/latest)
→ Zotero → Tools → Plugins → ⚙ → Install Plugin From File… Updates are automatic.

## Features

- **Snippets** — triggers, tabstops with placeholders, regex triggers, visual
  (selection-wrapping) snippets, function replacements, snippet variables,
  priorities. The format and every option letter are unchanged, so
  [Latex Suite's DOCS.md](https://github.com/artisticat1/obsidian-latex-suite/blob/main/DOCS.md#snippets)
  is the reference.
- **Auto-fraction** — `x/` becomes `\frac{x}{}`, brackets and greek letters
  included.
- **Tabout** — <kbd>Tab</kbd> at the end of an equation leaves it; otherwise it
  advances past the next closing bracket.
- **Matrix shortcuts** — inside `pmatrix`, `cases`, `align` and friends,
  <kbd>Tab</kbd> adds a cell, <kbd>Enter</kbd> a row, <kbd>Shift</kbd>+<kbd>Enter</kbd>
  leaves.
- **Auto-enlarge brackets** — a bracket pair containing `\sum`, `\int`, `\frac`…
  grows a `\left`/`\right`.

### Annotations

Snippets and rendering also work in PDF/EPUB **annotation comments**. Those are
plain text, so there an equation is `$…$` / `$$…$$` exactly as in Obsidian —
which is also what makes it portable: it survives sync and export, and "Add Note
from Annotations" turns it into a real equation in the note.

`$…$` renders as you write. Every equation in the comment is drawn except the
one the cursor is inside, which stays as source so you can keep editing it —
click a rendered equation to get back into it. Works in the reader sidebar, the
in-page popups, and the item pane's annotation list.

Typing does not disturb the equations you are not editing. Zotero reads a
comment back out of its own DOM on every keystroke, so the rendering has to come
out of the way first; it goes back in during the same event, before the browser
paints, and from a cache keyed on the LaTeX source — so an equation only goes
through KaTeX again when its source actually changes.

Rendering is via KaTeX's MathML output, which Firefox draws natively, so the
plugin ships no fonts. Inline `$…$` has to look like an equation and not like
"$5 and $10", so a dollar pair with a space just inside it is left alone.

## How it maps onto Zotero

Zotero notes aren't markdown: an equation is a node in the note, and its LaTeX
source is edited in its own little editor, rendered live with KaTeX. That makes
most of the mapping easy and one part interesting:

- **Math mode is structural.** `m`/`n`/`M` mean "the cursor is in an equation
  node", not "the cursor is between `$` signs". No `$` scanning, no ambiguity.
- **`$…$` in a text-mode replacement creates an equation.** That is what
  Latex Suite's `mk` and `dm` snippets mean, so they work unchanged: `mk` gives
  an inline equation, `dm` a display one, with the tabstops inside it.
- **`t` (text mode) is the note itself** — paragraphs, headings, list items.
- **`c` / `C` (code) is a Zotero code block.**
- **In annotations none of that applies** — they hold plain text, so math is
  found by scanning for `$` the way Latex Suite does.

Features that only made sense against markdown are not here: conceal, inline
math preview, and bracket colouring all exist to show you what your `$…$` means,
and Zotero already renders the equation as you type.

Two known differences from upstream:

- Undo of an automatic expansion is one step (it restores what you had before
  the trigger, not the trigger itself), so the `U` option has no effect.
- On an otherwise empty paragraph, `mk` gives display math until you have
  clicked any equation once in that window. Cosmetic; see the `ponytail:` note in
  `src/editor/insert_math.ts`.

## Layout

Mirrors obsidian-latex-suite's, minus what does not apply:

```
bootstrap.js            chrome side: settings pane, and injecting the engine
                        into each note-editor iframe
src/
  main.ts               keymap, in DOCS.md#keymap-order
  default_snippets.js   the shipped snippets, copied verbatim from upstream
  editor/               what replaces CodeMirror: a flat string and a cursor
    buffer.ts           the contract, and its two backends
    pm.ts               ProseMirror, for notes
    contenteditable.ts  plain contenteditable, for annotation comments
    insert_math.ts      `$…$` in text mode -> an equation node (notes only)
  reader/annotations.ts rendering `$…$` in the reader
  render/math.ts        KaTeX -> MathML, shared with the item pane
  snippets/             parse.ts, snippets.ts, options.ts, tabstop.ts,
                        snippet_management.ts, sort.ts, luasnip_api/
  features/             run_snippets, autofraction, tabout, matrix_shortcuts,
                        auto_enlarge_brackets
  settings/settings.ts  defaults, and compiling them for the engine
  utils/                context.ts (where the cursor is), tokenizer, brackets
notes/                  what the Zotero note editor looks like from inside
```

## Development

```sh
npm install
npm run build     # -> build/content-script.js
npm run watch
node test.js      # engine self-check, outside Zotero
```

To run it from a checkout, point Zotero at the folder: create a file named
`latex-snippets@local` in `<profile>/extensions/` containing the absolute path
to this directory, then restart Zotero.

`./release.sh` builds, tests, tags and publishes.

## Credits and license

The snippet engine, the snippet format, and the default snippets are
[artisticat1/obsidian-latex-suite](https://github.com/artisticat1/obsidian-latex-suite)
by artisticat1, which in turn follows
[Gilles Castel's UltiSnips setup](https://castel.dev/post/lecture-notes-1/).
This is an unaffiliated port; please don't take Latex Suite's bug reports there
for anything that only happens here.

MIT, for both the original and this port — see [LICENSE](LICENSE).
