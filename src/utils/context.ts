/* Where the cursor is, in LaTeX terms.
 *
 * Latex Suite derives this from a lezer grammar over the whole markdown
 * document, most of which exists to answer "am I inside `$…$`?". Zotero answers
 * that structurally — math is its own node — so all that is left is scanning the
 * equation source for the enclosing `\begin{}`/macro scopes, which is what this
 * does.
 */
import { Mode } from "src/snippets/options";
import { Buffer } from "src/editor/pm";
import { MacroArea, snippetLessArea, textArea } from "./default_text_areas";
import { Environment } from "src/snippets/environment";

export type Scope = {
	kind: "environment" | "command" | "group";
	/** environment name, macro name, or the sub/superscript character for a bare group */
	name: string;
	/** which argument of the macro this group is, counting from 0 */
	argIndex: number;
	/** offset of the opening token */
	start: number;
};

const MACRO = /^\\([A-Za-z@]+|.)/;
const ENV_ARG = /^\s*\{([^}]*)\}/;

/** The scopes enclosing `pos`, innermost first. */
export function scanScopes(text: string, pos: number): Scope[] {
	const stack: Scope[] = [];
	// `depth` is the stack depth the macro was seen at: text inside one of its
	// arguments must not end it, or `\textcolor{red}{x}` would lose the macro
	// before its second argument.
	let macro: { name: string; argIndex: number; depth: number } | null = null;
	let prevChar = "";
	let i = 0;

	while (i < pos) {
		const c = text[i];

		if (c === "\\") {
			const m = MACRO.exec(text.slice(i));
			if (!m) { i++; continue; }
			const name = m[1];
			if (name === "begin" || name === "end") {
				const arg = ENV_ARG.exec(text.slice(i + m[0].length));
				if (arg) {
					if (name === "begin") {
						stack.push({ kind: "environment", name: arg[1], argIndex: 0, start: i });
					} else {
						for (let k = stack.length - 1; k >= 0; k--) {
							const wasEnv = stack[k].kind === "environment";
							stack.splice(k, 1);
							if (wasEnv) break;
						}
					}
					i += m[0].length + arg[0].length;
					macro = null;
					prevChar = "}";
					continue;
				}
			}
			macro = { name, argIndex: 0, depth: stack.length };
			i += m[0].length;
			prevChar = "\\";
			continue;
		}

		if (c === "{") {
			stack.push({
				kind: macro ? "command" : "group",
				name: macro ? macro.name : prevChar,
				argIndex: macro ? macro.argIndex : 0,
				start: i,
			});
			if (macro) macro.argIndex++;
			i++;
			prevChar = "{";
			continue;
		}

		if (c === "}") {
			// `\begin`/`\end` groups never got pushed, so the innermost
			// non-environment scope is always the one this closes.
			for (let k = stack.length - 1; k >= 0; k--) {
				if (stack[k].kind !== "environment") { stack.splice(k, 1); break; }
			}
			i++;
			prevChar = "}";
			continue;
		}

		if (c === " " || c === "\t" || c === "\n") { i++; continue; } // a macro's argument may be spaced away

		if (macro && stack.length === macro.depth) macro = null;
		prevChar = c;
		i++;
	}

	return stack.reverse();
}

export function isMacroArgumentCount(scope: Scope, areas: readonly MacroArea[]): boolean {
	return areas.some(
		(area) => area.name === scope.name && (area.arguments === undefined || area.arguments.includes(scope.argIndex)),
	);
}

/** Reduce an `openSymbol` such as `"^{"` or `"\\pu{"` to the scope name it produces. */
function envScopeName(env: Environment): string {
	return env.openSymbol.replace(/\{$/, "").replace(/^\\/, "");
}

export class Context {
	mode: Mode;
	pos: number;
	buffer: Buffer;
	scopes: Scope[];

	private constructor(buffer: Buffer, mode: Mode, scopes: Scope[]) {
		this.buffer = buffer;
		this.mode = mode;
		this.scopes = scopes;
		this.pos = buffer.to;
	}

	static fromBuffer(buffer: Buffer): Context {
		const mode = new Mode();
		const scopes = buffer.inMath ? scanScopes(buffer.text, buffer.to) : [];

		if (buffer.kind === "math_inline") mode.inlineMath = true;
		else if (buffer.kind === "math_display") mode.blockMath = true;
		else if (buffer.kind === "code") { mode.code = true; mode.codeBlock = true; }
		else mode.text = true;

		// The innermost macro decides whether we are really in math: an
		// environment resets the scope, anything else is transparent.
		for (const scope of scopes) {
			if (scope.kind === "environment") break;
			if (isMacroArgumentCount(scope, snippetLessArea)) { mode.snippetlessEnv = true; break; }
			if (isMacroArgumentCount(scope, textArea)) { mode.textEnv = true; break; }
		}

		return new Context(buffer, mode, scopes);
	}

	/** The whole equation, in buffer offsets. Latex Suite's `$…$` bounds. */
	getBounds(): { inner_start: number; inner_end: number; outer_start: number; outer_end: number } | null {
		if (!this.buffer.inMath) return null;
		return { inner_start: 0, inner_end: this.buffer.text.length, outer_start: 0, outer_end: this.buffer.text.length };
	}

	getEnvNames(): Scope[] {
		return this.scopes;
	}

	isWithinEnvironment(env: Environment): boolean {
		const name = envScopeName(env);
		return this.scopes.some((s) => s.name === name);
	}
}
