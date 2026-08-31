// Ported from obsidian-latex-suite (src/utils/default_text_areas.ts), minus the
// valibot schema — snippet validation is hand-rolled here (see snippets/parse.ts).
export type MacroArea = { name: string; arguments?: number[] };

export function normalizeMacroAreas(value: unknown): MacroArea[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) throw new Error("expected an array of macro names");
	return value.map((item) => {
		if (typeof item === "string") return { name: item };
		if (item && typeof item.name === "string") return { name: item.name, arguments: item.arguments };
		throw new Error("expected a macro name or {name, arguments}");
	});
}

/** Macros whose argument is typeset as text, so math snippets shouldn't fire there. */
export const textArea: MacroArea[] = [
	{ name: "text" }, { name: "textrm" }, { name: "textup" }, { name: "textit" },
	{ name: "textbf" }, { name: "textsf" }, { name: "texttt" }, { name: "textnormal" },
	{ name: "clap" }, { name: "textllap" }, { name: "textrlap" }, { name: "textclap" },
	{ name: "hbox" }, { name: "mbox" }, { name: "fbox" }, { name: "framebox" },
];

/** Macros whose argument is neither text nor math — no snippets at all. */
export const snippetLessArea: MacroArea[] = [
	{ name: "tag" }, { name: "begin" }, { name: "end" }, { name: "mmlToken" },
	{ name: "unicode" }, { name: "textcolor", arguments: [0] }, { name: "color" },
	{ name: "colorbox" }, { name: "fcolorbox" },
];
