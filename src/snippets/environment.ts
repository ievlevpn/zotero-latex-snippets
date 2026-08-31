import { MacroArea } from "src/utils/default_text_areas";

/** A math environment where snippet semantics differ from plain math mode. */
export interface Environment {
	openSymbol: string;
	closeSymbol: string;
}

/** Triggers that should not run inside certain macros. */
export const EXCLUSIONS: { [trigger: string]: MacroArea[] } = {
	"([A-Za-z])(\\d)": [{ name: "ce" }, { name: "pu" }],
	"->": [{ name: "ce" }],
};
