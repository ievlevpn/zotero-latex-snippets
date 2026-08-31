// The `require("latex-suite")` surface documented in DOCS.md#nodes.
import { BaseNode, CaptureNode, TabstopNode, TextNode } from "./node";
import type { SnippetVariables } from "../parse";

export function api(snippetVariables: SnippetVariables) {
	return {
		snippetVariables,
		tabstop_node: (index: number, insert: string = ""): BaseNode => new TabstopNode(index, insert),
		text_node: (text: string): BaseNode => new TextNode(text),
		capture_node: (key: string | number, defaultValue: string = ""): BaseNode =>
			new CaptureNode(key, defaultValue),
	};
}
