export function isReactSource(source: string): boolean {
  return source === "react" || source === "preact/hooks" || source === "preact/compat";
}
