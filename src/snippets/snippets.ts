/* Ported from obsidian-latex-suite (src/snippets/snippets.ts).
 * Same three snippet types, same matching rules; valibot's runtime schemas are
 * replaced by the hand validation in parse.ts, and CodeMirror's `SelectionRange`
 * by a plain `{from, to}` in the current buffer.
 */
import { Options } from "./options";
import { ArrayNode, BaseNode, ResultInsert, SnippetTabstopOnlyNode, Options as InsertOptions } from "./luasnip_api/node";
import { MacroArea } from "src/utils/default_text_areas";
import { isMacroArgumentCount, Scope } from "src/utils/context";

/** In a visual snippet's replacement string, the magic substring for the selection. */
export const VISUAL_SNIPPET_MAGIC_SELECTION_PLACEHOLDER = "${VISUAL}";

export type SnippetType = "visual" | "regex" | "string";

/** The unstable handle handed to replacement functions. */
export type SnippetReplacementApi = { _view: unknown; _buffer: unknown };

function convertOutputToNode(rawReplacement: unknown): ArrayNode | null {
	if (rawReplacement === false) return null;
	if (typeof rawReplacement === "string") return new ArrayNode([new SnippetTabstopOnlyNode(rawReplacement)]);
	if (Array.isArray(rawReplacement) && rawReplacement.every((n) => n instanceof BaseNode)) {
		return new ArrayNode(rawReplacement);
	}
	console.error("latex-snippets: invalid replacement output:", rawReplacement);
	return null;
}

export type SnippetData<T extends SnippetType> = {
	visual: {
		trigger: string;
		replacement: ArrayNode | ((selection: string, api: SnippetReplacementApi) => unknown);
	};
	regex: {
		trigger: RegExp;
		replacement: ArrayNode | ((match: RegExpExecArray, api: SnippetReplacementApi) => unknown);
		triggerAfter?: RegExp;
	};
	string: {
		trigger: string;
		replacement: ArrayNode | ((match: string, api: SnippetReplacementApi) => unknown);
		triggerAfter?: string;
	};
}[T];

export type ProcessSnippetResult =
	| { triggerPos: number; replacement: ResultInsert; triggerEndPos?: number }
	| null;

export enum IncludedEnvironmentResult {
	None,
	Included,
	NotIncluded,
}

export type ProcessArgs = {
	effectiveLine: string;
	range: { from: number; to: number };
	sel: string;
	effectiveLineAfter: () => string;
	api: SnippetReplacementApi;
};

export type CreateSnippet<T extends SnippetType> = {
	options: Options;
	priority?: number;
	description?: string;
	excludedEnvironments?: string[];
	excludedMacros?: MacroArea[];
	includedMacros?: MacroArea[];
	triggerKey?: string;
} & SnippetData<T>;

export abstract class Snippet<T extends SnippetType = SnippetType> {
	type: T;
	data: SnippetData<T>;
	options: Options;
	priority: number;
	description: string;
	triggerKey: string;
	excludedEnvironments: string[];
	excludedMacros: MacroArea[];
	includedMacros: MacroArea[];

	constructor(
		type: T,
		trigger: SnippetData<T>["trigger"],
		replacement: SnippetData<T>["replacement"],
		options: Options,
		priority = 0,
		description = "no description provided",
		excludedEnvironments: string[] = [],
		excludedMacros: MacroArea[] = [],
		includedMacros: MacroArea[] = [],
		triggerKey = "",
	) {
		this.type = type;
		this.data = { trigger, replacement } as SnippetData<T>;
		this.options = options;
		this.priority = priority;
		this.description = description;
		this.excludedEnvironments = excludedEnvironments;
		this.excludedMacros = excludedMacros;
		this.includedMacros = includedMacros;
		this.triggerKey = triggerKey;
	}

	get trigger(): SnippetData<T>["trigger"] { return this.data.trigger; }
	get replacement(): SnippetData<T>["replacement"] { return this.data.replacement; }

	abstract process(args: ProcessArgs): ProcessSnippetResult;

	isWithinExcludedScope(scopes: Scope[]): boolean {
		if (this.excludedEnvironments.length === 0 && this.excludedMacros.length === 0) return false;
		for (const scope of scopes) {
			if (scope.kind === "environment") {
				return this.excludedEnvironments.includes(scope.name);
			}
			if (isMacroArgumentCount(scope, this.excludedMacros)) return true;
		}
		return false;
	}

	isWithinIncludedScope(scopes: Scope[]): IncludedEnvironmentResult {
		if (this.includedMacros.length === 0) return IncludedEnvironmentResult.None;
		if (scopes.length === 0) return IncludedEnvironmentResult.NotIncluded;
		const innermost = scopes[0];
		if (innermost.kind === "environment") return IncludedEnvironmentResult.NotIncluded;
		return isMacroArgumentCount(innermost, this.includedMacros)
			? IncludedEnvironmentResult.Included
			: IncludedEnvironmentResult.NotIncluded;
	}

	toString() {
		return serializeSnippetLike({
			type: this.type,
			trigger: this.trigger,
			replacement: this.replacement,
			options: this.options,
			priority: this.priority,
			description: this.description,
		});
	}
}

export class VisualSnippet extends Snippet<"visual"> {
	constructor(c: CreateSnippet<"visual">) {
		super("visual", c.trigger, c.replacement, c.options, c.priority, c.description,
			c.excludedEnvironments, c.excludedMacros, c.includedMacros, c.triggerKey);
	}

	process({ effectiveLine, range, sel, api }: ProcessArgs): ProcessSnippetResult {
		if (!sel) return null; // visual snippets only run on a selection
		if (!effectiveLine.endsWith(this.trigger)) return null;

		const captures = { match: [] as string[], groups: { [VISUAL_SNIPPET_MAGIC_SELECTION_PLACEHOLDER]: sel } };
		const options: InsertOptions = { captures };

		let replacement: ResultInsert;
		if (this.replacement instanceof ArrayNode) {
			replacement = this.replacement.applyInsert(options);
		} else {
			const node = convertOutputToNode(this.replacement(sel, api));
			if (node === null) return null;
			replacement = node.applyInsert(options);
		}

		return { triggerPos: range.from, replacement };
	}
}

export class RegexSnippet extends Snippet<"regex"> {
	constructor(c: CreateSnippet<"regex">) {
		super("regex", c.trigger, c.replacement, c.options, c.priority, c.description,
			c.excludedEnvironments, c.excludedMacros, c.includedMacros, c.triggerKey);
		this.data.triggerAfter = c.triggerAfter;
	}

	process({ effectiveLine, sel, effectiveLineAfter, api }: ProcessArgs): ProcessSnippetResult {
		if (sel) return null;

		const result = this.trigger.exec(effectiveLine);
		if (result === null) return null;

		const afterResult = this.data.triggerAfter?.exec(effectiveLineAfter());
		if (this.data.triggerAfter && afterResult === null) return null;

		const triggerPos = result.index;
		const triggerEndPos = afterResult ? effectiveLine.length + afterResult[0].length : undefined;

		const options: InsertOptions = { captures: { match: result.slice(1), groups: result.groups ?? {} } };

		let replacement: ResultInsert;
		if (this.replacement instanceof ArrayNode) {
			replacement = this.replacement.applyInsert(options);
		} else {
			const node = convertOutputToNode(this.replacement(result, api));
			if (node === null) return null;
			replacement = node.applyInsert(options);
		}

		return { triggerPos, replacement, triggerEndPos };
	}
}

export class StringSnippet extends Snippet<"string"> {
	constructor(c: CreateSnippet<"string">) {
		super("string", c.trigger, c.replacement, c.options, c.priority, c.description,
			c.excludedEnvironments, c.excludedMacros, c.includedMacros, c.triggerKey);
		this.data.triggerAfter = c.triggerAfter;
	}

	process({ effectiveLine, sel, effectiveLineAfter, api }: ProcessArgs): ProcessSnippetResult {
		if (sel) return null;
		if (!effectiveLine.endsWith(this.trigger)) return null;
		if (this.data.triggerAfter && !effectiveLineAfter().startsWith(this.data.triggerAfter)) return null;

		const triggerPos = effectiveLine.length - this.trigger.length;
		const triggerEndPos =
			this.data.triggerAfter !== undefined ? effectiveLine.length + this.data.triggerAfter.length : undefined;

		const options: InsertOptions = { captures: { match: [this.trigger], groups: {} } };

		let replacement: ResultInsert;
		if (this.replacement instanceof ArrayNode) {
			replacement = this.replacement.applyInsert(options);
		} else {
			const node = convertOutputToNode(this.replacement(this.trigger, api));
			if (node === null) return null;
			replacement = node.applyInsert(options);
		}

		return { triggerPos, replacement, triggerEndPos };
	}
}

function replacer(_k: string, v: unknown) {
	if (typeof v === "function") return "[[Function]]";
	if (v instanceof RegExp) return `[[RegExp]]: ${v.toString()}`;
	return v;
}

export function serializeSnippetLike(snippetLike: unknown) {
	return JSON.stringify(snippetLike, replacer, 2);
}
