// Ported from obsidian-latex-suite (src/snippets/luasnip_api/node.ts).
// Pure string/tabstop logic — nothing editor-specific, so it transfers verbatim.
import { VISUAL_SNIPPET_MAGIC_SELECTION_PLACEHOLDER } from "../snippets";
import { TabstopSpec } from "../tabstop";

type Captures = { match: string[]; groups: Record<string, string> };

export type Options = { captures: Captures };

export const emptyInsertOptions: Options = {
	captures: { match: [], groups: {} },
};

export type ResultInsert = {
	insert: string;
	tabstops: readonly TabstopSpec[];
};

export class BaseNode {
	constructor(
		public insert: string | ((context: Options) => string | BaseNode[]),
		public tabstops: readonly TabstopSpec[] = [],
	) {}

	applyInsert(options: Options = emptyInsertOptions): ResultInsert {
		if (typeof this.insert === "string") {
			return { insert: this.insert, tabstops: this.tabstops };
		}
		const result = this.insert(options);
		if (typeof result === "string") {
			return { insert: result, tabstops: this.tabstops };
		}

		let offset = 0;
		const tabstopResults = result
			.map((node) => node.applyInsert(options))
			.map(({ insert, tabstops }) => {
				const currentOffset = offset;
				offset += insert.length;
				return {
					insert,
					tabstops: [
						...tabstops.map((ts) => ({ ...ts, from: ts.from + currentOffset, to: ts.to + currentOffset })),
						...this.tabstops.map((ts) => ({ ...ts, from: ts.from + currentOffset, to: ts.to + currentOffset })),
					],
				};
			});
		return {
			insert: tabstopResults.map((r) => r.insert).join(""),
			tabstops: tabstopResults.flatMap((r) => r.tabstops),
		};
	}
}

export class TextNode extends BaseNode {
	constructor(text: string) {
		super(text);
	}
}

export class TabstopNode extends BaseNode {
	constructor(index: number, insert: string = "") {
		super(insert, [{ index: [index], from: 0, to: insert.length }]);
	}
}

export class CaptureNode extends BaseNode {
	constructor(key: number | string, defaultValue: string = "") {
		if (typeof key === "number") {
			super(({ captures }) => captures.match[key] ?? defaultValue);
		} else {
			super(({ captures }) => captures.groups[key] ?? defaultValue);
		}
	}
}

export type Replacement = { start: number; end: number; replacement: string };

export function applyReplacements(str: string, replacements: Replacement[]): string {
	replacements.sort((a, b) => a.start - b.start);
	let offset = 0;
	const parts: string[] = [];
	for (const { start, end, replacement } of replacements) {
		parts.push(str.slice(offset, start), replacement);
		offset = end;
	}
	return parts.join("") + str.slice(offset);
}

export class SnippetStringNode extends BaseNode {
	constructor(private snippet: string) {
		super((options) => this.parseSnippet(options.captures));
	}

	parseSnippet(captures: Captures): BaseNode[] {
		return this.expandTabstops(this.expandCaptures(captures));
	}

	expandCaptures(captures: Captures): string {
		const replacements: Replacement[] = [];
		for (const match of this.snippet.matchAll(/\[\[(\d+)\]\]/g)) {
			const index = parseInt(match[1]);
			if (index >= captures.match.length) continue;
			const start = match.index as number;
			replacements.push({ start, end: start + match[0].length, replacement: captures.match[index] ?? "" });
		}
		return applyReplacements(this.snippet, replacements);
	}

	expandTabstops(snippet: string): BaseNode[] {
		const replacements: (Replacement & { index: number })[] = [];
		for (const match of snippet.matchAll(/\$(\d)|\$\{(\d+):([^}]*)\}/g)) {
			const start = match.index as number;
			replacements.push({
				start,
				end: start + match[0].length,
				replacement: match[3] || "",
				index: parseInt(match[1] || match[2]),
			});
		}
		const nodes: BaseNode[] = [];
		let offset = 0;
		for (const { start, end, replacement, index } of replacements) {
			nodes.push(new TextNode(snippet.slice(offset, start)));
			nodes.push(new TabstopNode(index, replacement));
			offset = end;
		}
		nodes.push(new TextNode(snippet.slice(offset)));
		return nodes;
	}
}

export class VisualSnippetNode extends BaseNode {
	constructor(public snippet: string) {
		super((options) =>
			new SnippetStringNode(this.expandVisual(options.captures)).parseSnippet({ match: [], groups: {} }),
		);
	}

	expandVisual(captures: Captures): string {
		const sel = captures.groups[VISUAL_SNIPPET_MAGIC_SELECTION_PLACEHOLDER];
		if (sel === undefined) {
			throw new Error(
				`VisualSnippetNode requires a capture group named ${VISUAL_SNIPPET_MAGIC_SELECTION_PLACEHOLDER}`,
			);
		}
		return this.snippet.replaceAll(VISUAL_SNIPPET_MAGIC_SELECTION_PLACEHOLDER, sel);
	}
}

export class SnippetTabstopOnlyNode extends BaseNode {
	constructor(snippet: string) {
		super(() => new SnippetStringNode(snippet).parseSnippet({ match: [], groups: {} }));
	}
}

export class ArrayNode {
	constructor(private children: BaseNode[]) {}

	applyInsert(options: Options = emptyInsertOptions): ResultInsert {
		return new BaseNode(() => this.children).applyInsert(options);
	}
}
