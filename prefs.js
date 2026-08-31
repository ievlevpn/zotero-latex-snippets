/* Preferences pane for LaTeX Snippets. Registered from bootstrap.js; runs in the
 * Zotero settings window.
 *
 * Zotero loads pane scripts BEFORE inserting the pane markup (see
 * Zotero_Preferences._loadPane), so nothing here can touch the DOM at load
 * time — getElementById would return null and take the whole script down.
 * Everything is deferred until the markup actually appears.
 *
 * Everything is stored as one JSON object of *overrides* in a single pref: a
 * field left at its default is simply absent, so changing a default in a later
 * version reaches people who never touched it.
 */
{
	const XHTML = "http://www.w3.org/1999/xhtml";

	function init(fieldsEl) {
		const { PREF, FIELDS, defaultSnippets, defaultSnippetVariables } = Zotero.LatexSnippets;
		const h = (tag) => document.createElementNS(XHTML, tag);

		async function pick(input, folder) {
			const { FilePicker } = ChromeUtils.importESModule("chrome://zotero/content/modules/filePicker.mjs");
			const fp = new FilePicker();
			fp.init(window, folder ? "Select a snippets folder" : "Select a snippets file",
				folder ? fp.modeGetFolder : fp.modeOpen);
			if (!folder) {
				fp.appendFilter("JavaScript", "*.js");
				fp.appendFilters(fp.filterAll);
			}
			if ((await fp.show()) !== fp.returnOK) return;
			input.value = fp.file;
			input.dispatchEvent(new Event("input", { bubbles: true }));
		}

		const read = () => {
			try {
				const parsed = JSON.parse(Zotero.Prefs.get(PREF, true) || "{}");
				return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
			} catch (e) {
				return {}; // unset or unreadable → show defaults; saving overwrites
			}
		};

		let overrides = read();

		/* Every write wakes the pref observer, which re-parses the whole snippet
		 * file in every open note and reader. Typing in the snippets box would do
		 * that on each keystroke, so writes are held until you pause — and flushed
		 * on the way out so nothing is lost. */
		let pending = null;

		const write = () => {
			if (pending) { clearTimeout(pending); pending = null; }
			Zotero.Prefs.set(PREF, JSON.stringify(overrides), true);
		};
		const writeSoon = () => {
			if (pending) clearTimeout(pending);
			pending = setTimeout(write, 400);
		};

		const setValue = (key, value, fallback, immediate) => {
			// Storing only what differs keeps future default changes flowing through.
			if (value === fallback) delete overrides[key];
			else overrides[key] = value;
			if (immediate) write();
			else writeSoon();
			onChanged();
		};

		let onChanged = () => {};

		window.addEventListener("unload", write, { once: true });

		/* --- the two code areas --- */

		function wireCodeArea(id, defaultSource, key, validate) {
			const area = document.getElementById(id);
			const status = document.getElementById(id + "-status");
			const reset = document.getElementById(id + "-reset");
			if (!area) return;

			area.value = key in overrides ? overrides[key] : defaultSource;

			const check = () => {
				try {
					const count = validate(area.value);
					status.textContent = count;
					status.classList.remove("ls-error");
				} catch (e) {
					status.textContent = String(e.message || e);
					status.classList.add("ls-error");
				}
			};

			let timer = null;
			area.addEventListener("input", () => {
				setValue(key, area.value, defaultSource);
				if (timer) clearTimeout(timer);
				timer = setTimeout(check, 300);
			});
			area.addEventListener("blur", write);
			reset.addEventListener("click", () => {
				area.value = defaultSource;
				setValue(key, defaultSource, defaultSource, true);
				check();
			});
			check();
		}

		// A cheap syntax check so a typo shows up here rather than silently in a
		// note. The engine does the real parsing; this only has to catch garbage.
		const checkModule = (label) => (source) => {
			const body = /(^|[\s;}])export\s+default\s/.test(source)
				? source.replace(/(^|[\s;}])export\s+default\s/, "$1return ")
				: `return (\n${source}\n);`;
			const value = new Function("require", body)(() => ({}));
			if (label === "snippets") {
				if (!Array.isArray(value)) throw new Error("expected an array of snippets");
				return `${value.flat().length} snippets`;
			}
			if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("expected an object");
			return `${Object.keys(value).length} variables`;
		};

		wireCodeArea("ls-snippets", defaultSnippets, "snippets", checkModule("snippets"));
		wireCodeArea("ls-variables", defaultSnippetVariables, "snippetVariables", checkModule("variables"));

		/* The boxes above are ignored while their source is a file; grey them out
		 * rather than letting someone edit text that is not being used. */
		function syncCodeAreas() {
			for (const [areaID, enabledKey] of [
				["ls-snippets", "loadSnippetsFromFile"],
				["ls-variables", "loadSnippetVariablesFromFile"],
			]) {
				const area = document.getElementById(areaID);
				if (!area) continue;
				const fromFile = overrides[enabledKey] === true;
				area.disabled = fromFile;
				area.title = fromFile ? "Loaded from a file; edit that file instead." : "";
			}
		}

		/* --- the scalar fields, grouped --- */

		/* Whether a file actually loads is the whole question with this setting, so
		 * say so rather than leaving it to be discovered in a note. */
		const fileStatuses = [];
		const sourceKeyFor = (key) => (key.startsWith("snippetVariables") ? "snippetVariables" : "snippets");

		async function refreshFileStatuses() {
			for (const { field, input, status } of fileStatuses) {
				const path = input.value.trim();
				if (!path) {
					status.textContent = "";
					status.classList.remove("ls-error");
					continue;
				}
				const key = sourceKeyFor(field.key);
				const loaded = Zotero.LatexSnippets.fileStatus(key);
				try {
					const { sources, files } = await Zotero.LatexSnippets.readSourceAt(path);
					const check = checkModule(key === "snippets" ? "snippets" : "variables");
					// Report the whole folder, not just whichever file failed first.
					const counts = sources.map((source, i) => {
						try {
							return check(source);
						} catch (e) {
							throw new Error(files[i].leafName + ": " + (e.message || e));
						}
					});
					status.textContent = files.length > 1
						? `${files.length} files \u2014 ${counts.join(", ")}`
						: counts[0];
					status.classList.remove("ls-error");
				} catch (e) {
					status.textContent = String((loaded && loaded.error) || e.message || e);
					status.classList.add("ls-error");
				}
			}
		}

		let currentGroup = null;
		let body = null;

		for (const field of FIELDS) {
			if (field.group !== currentGroup) {
				currentGroup = field.group;
				const box = document.createElementNS(
					"http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul", "groupbox");
				const title = h("h2");
				title.textContent = currentGroup;
				box.append(title);
				body = h("div");
				box.append(body);
				fieldsEl.append(box);
			}

			const row = h("div");
			row.className = "ls-row";

			const stored = field.key in overrides ? overrides[field.key] : field.default;
			let input;

			if (field.type === "bool") {
				input = h("input");
				input.type = "checkbox";
				input.checked = !!stored;
				input.addEventListener("command", () => setValue(field.key, input.checked, field.default, true));
				input.addEventListener("change", () => setValue(field.key, input.checked, field.default, true));
			} else if (field.type === "number") {
				input = h("input");
				input.type = "number";
				input.min = "0";
				input.value = String(stored);
				input.addEventListener("input", () =>
					setValue(field.key, Math.max(0, parseInt(input.value, 10) || 0), field.default));
			} else if (field.type === "select") {
				input = h("select");
				for (const option of field.options) {
					const el = h("option");
					el.value = option;
					el.textContent = option;
					input.append(el);
				}
				input.value = stored;
				input.addEventListener("change", () => setValue(field.key, input.value, field.default, true));
			} else if (field.type === "file") {
				input = h("input");
				input.type = "text";
				input.value = stored;
				input.placeholder = "/path/to/latex_suite_snippets.js";
				input.addEventListener("input", () => setValue(field.key, input.value.trim(), field.default));
				input.addEventListener("blur", write);
			} else if (field.type === "code") {
				input = h("textarea");
				input.className = "ls-code";
				input.rows = field.rows || 4;
				input.spellcheck = false;
				input.value = stored;
				input.addEventListener("input", () => setValue(field.key, input.value, field.default));
				input.addEventListener("blur", write);
			} else {
				input = h("input");
				input.type = "text";
				input.value = stored;
				input.addEventListener("input", () => setValue(field.key, input.value, field.default));
				input.addEventListener("blur", write);
			}

			const label = h("label");
			label.textContent = field.label;

			// A checkbox reads better with its label after it.
			if (field.type === "bool") row.append(input, label);
			else row.append(label, input);

			if (field.type === "file") {
				for (const [label, folder] of [["File\u2026", false], ["Folder\u2026", true]]) {
					const browse = h("button");
					browse.type = "button";
					browse.textContent = label;
					browse.addEventListener("click", () => pick(input, folder));
					row.append(browse);
				}

				const status = h("div");
				status.className = "ls-field-hint";
				row.append(status);
				fileStatuses.push({ field, input, status });
			}

			if (field.hint) {
				const hint = h("div");
				hint.className = "ls-field-hint";
				hint.textContent = field.hint;
				row.append(hint);
			}

			body.append(row);
		}

		onChanged = () => {
			syncCodeAreas();
			refreshFileStatuses();
		};
		onChanged();
	}

	const start = () => {
		const fieldsEl = document.getElementById("ls-fields");
		if (!fieldsEl || !Zotero.LatexSnippets) return false;
		try {
			init(fieldsEl);
		} catch (e) {
			Zotero.debug("LaTeX Snippets: prefs pane failed - " + ((e && e.stack) || e));
		}
		return true;
	};

	// The markup is appended right after this script runs, but don't rely on the
	// exact timing — watch for it, and disconnect as soon as it lands.
	if (!start()) {
		const obs = new MutationObserver(() => {
			if (start()) obs.disconnect();
		});
		obs.observe(document, { childList: true, subtree: true });
	}
}
