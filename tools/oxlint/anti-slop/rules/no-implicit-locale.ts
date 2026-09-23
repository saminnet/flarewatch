import { defineRule } from "@oxlint/plugins";

import { staticMemberName, staticPropertyName } from "../shared/property-key.ts";

import type { ESTree } from "@oxlint/plugins";

type Argument = ESTree.CallExpression["arguments"][number];

interface Formatter {
  /** Index of the locale argument. */
  readonly localeAt: number;
  /** True when the output also depends on the runtime's time zone. */
  readonly needsTimeZone: boolean;
}

// `toLocaleString` is shared by Date and Number, and a plugin cannot tell them apart without type
// information, so it only has to name a locale.
const methods = new Map<string, Formatter>([
  ["toLocaleString", { localeAt: 0, needsTimeZone: false }],
  ["toLocaleDateString", { localeAt: 0, needsTimeZone: true }],
  ["toLocaleTimeString", { localeAt: 0, needsTimeZone: true }],
  ["localeCompare", { localeAt: 1, needsTimeZone: false }],
]);

const intlConstructors = new Map<string, Formatter>([
  ["Collator", { localeAt: 0, needsTimeZone: false }],
  ["DateTimeFormat", { localeAt: 0, needsTimeZone: true }],
  ["DisplayNames", { localeAt: 0, needsTimeZone: false }],
  ["DurationFormat", { localeAt: 0, needsTimeZone: false }],
  ["ListFormat", { localeAt: 0, needsTimeZone: false }],
  ["NumberFormat", { localeAt: 0, needsTimeZone: false }],
  ["PluralRules", { localeAt: 0, needsTimeZone: false }],
  ["RelativeTimeFormat", { localeAt: 0, needsTimeZone: false }],
  ["Segmenter", { localeAt: 0, needsTimeZone: false }],
]);

/** The formatter a call or `new` expression reaches, with the name to report. */
function formatterFor(callee: ESTree.Node): { name: string; formatter: Formatter } | null {
  if (callee.type !== "MemberExpression") return null;
  const name = staticMemberName(callee);
  if (name === null) return null;
  const object = callee.object;
  if (object.type === "Identifier" && object.name === "Intl") {
    const formatter = intlConstructors.get(name);
    return formatter === undefined ? null : { name: `Intl.${name}`, formatter };
  }
  const formatter = methods.get(name);
  return formatter === undefined ? null : { name, formatter };
}

/** Missing, `undefined`, `"default"`, and `[]` all mean "whatever the runtime uses". */
function isImplicitLocale(argument: Argument | undefined): boolean {
  if (argument === undefined) return true;
  if (argument.type === "Identifier") return argument.name === "undefined";
  if (argument.type === "Literal") return argument.value === "default";
  if (argument.type === "ArrayExpression") return argument.elements.length === 0;
  return false;
}

/** False only when the options are a literal that visibly leaves `timeZone` out. */
function mayHaveTimeZone(options: Argument | undefined): boolean {
  if (options === undefined) return false;
  if (options.type !== "ObjectExpression") return true;
  return options.properties.some(
    (property) =>
      property.type === "SpreadElement" ||
      (property.computed
        ? staticPropertyName(property.key) === "timeZone"
        : property.key.type === "Identifier"
          ? property.key.name === "timeZone"
          : property.key.type === "Literal" && property.key.value === "timeZone"),
  );
}

/** Require an explicit locale, and a time zone where the output depends on one. */
export const noImplicitLocaleRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Require an explicit locale and time zone for locale-sensitive formatting, so server and browser output match.",
    },
    messages: {
      implicitLocale:
        "`{{name}}` without an explicit locale uses the runtime's, so the server and each browser can format it differently. Pass a locale.",
      implicitTimeZone:
        "`{{name}}` without a `timeZone` option uses the runtime's time zone, so the server and each browser can format it differently. Pass `timeZone`.",
    },
  },
  createOnce(context) {
    const check = (node: ESTree.CallExpression | ESTree.NewExpression) => {
      const target = formatterFor(node.callee);
      if (target === null) return;
      const { name, formatter } = target;
      const args = node.arguments;
      if (args.slice(0, formatter.localeAt + 2).some((arg) => arg.type === "SpreadElement")) return;
      if (isImplicitLocale(args[formatter.localeAt])) {
        context.report({ node, messageId: "implicitLocale", data: { name } });
        return;
      }
      if (formatter.needsTimeZone && !mayHaveTimeZone(args[formatter.localeAt + 1])) {
        context.report({ node, messageId: "implicitTimeZone", data: { name } });
      }
    };
    return { CallExpression: check, NewExpression: check };
  },
});
