import type { ESTree } from "@oxlint/plugins";

/**
 * The fixed string a computed key names. `x["k"]` and a template with no substitutions both name
 * `k`; anything the parser cannot resolve to one string is null.
 */
export function staticPropertyName(property: ESTree.Node): string | null {
	if (property.type === "Literal") {
		return typeof property.value === "string" ? property.value : null;
	}
	if (property.type !== "TemplateLiteral" || property.expressions.length > 0) return null;
	return property.quasis[0]?.value.cooked ?? null;
}

/** The name a member access reads, as in `x.k`, `x["k"]`, or `` x[`k`] ``, or null when it varies. */
export function staticMemberName(member: ESTree.MemberExpression): string | null {
	if (member.computed) return staticPropertyName(member.property);
	return member.property.type === "Identifier" ? member.property.name : null;
}
