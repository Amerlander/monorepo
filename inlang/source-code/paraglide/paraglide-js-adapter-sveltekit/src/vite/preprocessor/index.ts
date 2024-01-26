import { parse, type PreprocessorGroup } from "svelte/compiler"
import MagicString from "magic-string"
import type { Ast } from "./types.js"
import { createTranslateAttributePass, type AttributeTranslation } from "./rewrites/pass.js"

export type PreprocessorConfig = Record<string, never>

type MarkupPreprocessorArgs = {
	filename: string
	content: string
}

export type PreprocessingPass = {
	/**
	 * A quick and cheap check to see if this pass should be applied.
	 * This is used to avoid parsing the file if it's not necessary.
	 */
	condition: (data: MarkupPreprocessorArgs) => boolean

	/**
	 * Applies the pass to the file.
	 * Should only be called if `condition` returned true, since it may assume that.
	 *
	 * @param ast 	The AST of the file.
	 * @param code 	The code of the file. Modify this directly.
	 * @returns A list of imports that should be injected into the file.
	 */
	apply: (data: { ast: Ast; code: MagicString; originalCode: string }) => {
		scriptAdditions?: { before?: Iterable<string>; after?: Iterable<string> }
	}
}

const TRANSLATIONS: AttributeTranslation[] = [
	{
		element_name: "a",
		attribute_name: "href",
		lang_attribute_name: "hreflang",
	},

	{
		element_name: "form",
		attribute_name: "action",
	},
	{
		element_name: "button",
		attribute_name: "formaction",
	},
]

const PASS = createTranslateAttributePass(TRANSLATIONS)

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function preprocessor(_config: PreprocessorConfig): PreprocessorGroup {
	return {
		name: "@inlang/paraglide-js-adapter-sveltekit",
		markup: ({ filename, content }) => {
			const NOOP = { code: content }

			//I dont' know when this would happen, but it's better to be safe than sorry
			if (!filename) return NOOP

			//dont' process components owned by the framework
			if (filename.includes(".svelte-kit")) return NOOP

			//Run quick checks to see if preprocessing should be applied - skip parsing if not
			if (!PASS.condition({ filename, content })) return NOOP

			//Parse the file
			const ast = parse(content)
			const code = new MagicString(content)

			const passResult = PASS.apply({ ast, code, originalCode: content })

			const before = new Set<string>(passResult.scriptAdditions?.before)
			const after = new Set<string>(passResult.scriptAdditions?.after)

			//Inject any imports that were added by the passes
			modifyScriptTag(ast, code, { before, after })

			//Generate the code and map
			const map = code.generateMap({ hires: true })
			return { code: code.toString(), map }
		},
	}
}

function modifyScriptTag(
	ast: Ast,
	code: MagicString,
	additions: { before?: Iterable<string>; after?: Iterable<string> }
) {
	const before = additions.before ? [...additions.before] : []
	const after = additions.after ? [...additions.after] : []

	if (!ast.instance) {
		code.prepend("<script>\n" + before.join("\n") + "\n" + after.join("\n") + "</script>\n")
	} else {
		//@ts-ignore
		const scriptStart = ast.instance.content.start as number
		//@ts-ignore
		const scriptEnd = ast.instance.content.end as number
		code.appendLeft(scriptStart, "\n" + before.join("\n") + "\n")
		code.appendRight(scriptEnd, "\n" + after.join("\n") + "\n")
	}
}
