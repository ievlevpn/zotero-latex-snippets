# Zotero note editor — what a snippet engine can hook into

Findings from `/Applications/Zotero 2.app/Contents/Resources/app/omni.ja`
(unzip it; everything below is in `resource/note-editor/editor.js`, minified,
and `chrome/content/zotero/...`).

## The editor

`<note-editor>` (chrome/content/zotero/elements/noteEditor.js) wraps an
`<iframe type="content" src="resource://zotero/note-editor/editor.html">`.
The iframe runs a **ProseMirror** app bundled with **KaTeX**. Content
principal, so chrome code sees Xray wrappers — Zotero itself writes helpers
onto `iframeWindow.wrappedJSObject` (`zoteroExecCommand`, …).

Reachable objects inside the iframe:

```
window._currentEditorInstance          // the note-editor's own wrapper
window._currentEditorInstance._editorCore
    .view                              // outer ProseMirror EditorView
    .pluginState                       // {menu, table, citation, image, …}
    .insertMath()                      // insert math_display (empty block) or math_inline
window.getDataSync / canUndo / doUndo / …
```

## Math is a node, not `$…$` text

Schema (`math_inline`, `math_display`) — both `content: "text*"`, `marks: ""`,
`atom: true`, `math_display` also `code: true`. So the LaTeX source of an
equation is *plain text with no marks*, in its own node. That is the whole
"math mode" question answered structurally: no `$` scanning needed.

Node views are prosemirror-math `MathView`:
- DOM: `<math-inline class="math-node">` / `<math-display class="math-node">`
  containing `.math-render` (KaTeX output) and `.math-src`.
- Editing opens a **nested EditorView** on `.math-src` (`_innerView`), created
  in `selectNode()`/`openEditor()`, destroyed on deselect. Its transactions are
  mapped back into the outer doc by `dispatchInner`, so the outer history
  plugin still sees them → undo works.
- Its keymap: `Tab` → literal tab, `Enter`/`Ctrl-Enter`/arrows → leave the node,
  `Backspace` on empty → delete the node. No input rules, no history.

Getting the inner view from a keydown:

```js
const mathEl = doc.activeElement.closest('.math-node');
const innerView = mathEl.pmViewDesc.spec._innerView;   // CustomNodeViewDesc.spec === MathView
```

(`ViewDesc` sets `dom.pmViewDesc = this`; `CustomNodeViewDesc` keeps the node
view object in `.spec`.)

Inside the inner view the buffer is one flat string:
`innerView.state.doc.textContent`, cursor `selection.from - 1`. Replace with a
single `tr.replaceWith(...).setSelection(...)`. That is exactly the model
Latex Suite's snippet engine expects.

## Creating math from text mode

Only three default snippets need it (`mk`, `dm`). Options:
- `_editorCore.insertMath()` — display math if the block is empty, else inline.
- Zotero's own input rule `/\$([^\$]+)\$(?=[^\w\d])[\s\S]$/` → `math_inline`
  (needs a trailing non-word char, so not usable directly).
- Build the node ourselves from the outer view.

Mapping to keep the Latex Suite snippet format working unchanged: a text-mode
replacement wrapped in `$…$` becomes an inline math node, `$$…$$` a display
math node, and the tabstops land inside it.

## Injecting our code

The engine has to run *in* the content scope (building PM transactions from
chrome across Xrays is misery). Two workable ways, both fine on a `resource://`
document with no CSP (editor.html already has an inline `<script>`):

1. `doc.createElement('script')` + `textContent` + append to head.
2. `Cu.evalInSandbox(code, sandbox)` with `sandboxPrototype: iframeWindow`.

Hook for "a note editor appeared": wrap `Zotero.Notes.registerEditorInstance`
(called from `EditorInstance.init`); `instance._iframeWindow` is the iframe
window. `Zotero.Notes._editorInstances` holds the live ones for the initial
sweep on plugin startup. Covers notes in the item pane, note tabs, and
standalone note windows — one hook, all surfaces.

Key interception: a capture-phase `keydown` listener on the iframe *document*
runs before ProseMirror's own handler (registered on `view.dom`, bubbling),
for both the outer and any inner view.

## Features that don't need porting

Zotero already renders math live with KaTeX, so **conceal**, **inline math
preview**, and **bracket colouring/highlighting** are either moot or would
have to be reimplemented against a completely different rendering model.
