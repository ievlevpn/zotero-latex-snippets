// Bracket helpers, ported unchanged from obsidian-latex-suite — plain string
// work, no editor involved.
export function reverse(s: string) {
	return s.split("").reverse().join("");
}

export function findMatchingBracket(
	text: string,
	start: number,
	openBracket: string,
	closeBracket: string,
	searchBackwards: boolean,
	end?: number,
): number | null {
	if (searchBackwards) {
		const reversedIndex = findMatchingBracket(
			reverse(text),
			text.length - (start + closeBracket.length),
			reverse(closeBracket),
			reverse(openBracket),
			false,
		);
		if (reversedIndex === null) return null;
		return text.length - (reversedIndex + openBracket.length);
	}

	let brackets = 0;
	const stop = end ?? text.length;

	for (let i = start; i < stop; i++) {
		if (text.startsWith(openBracket, i)) {
			brackets++;
		} else if (text.startsWith(closeBracket, i)) {
			brackets--;
			if (brackets === 0) return i;
		}
	}

	return null;
}

export function getOpenBracket(closeBracket: string) {
	return ({ ")": "(", "]": "[", "}": "{" } as Record<string, string>)[closeBracket];
}

export function intersection<T>(a: Set<T>, b: Set<T>): Set<T> {
	return new Set([...a].filter((x) => b.has(x)));
}
