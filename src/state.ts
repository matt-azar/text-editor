export type LineEnding = "lf" | "crlf";

export function fileName(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

export function nextUntitled(names: string[]): string {
  if (!names.includes("Untitled")) return "Untitled";
  let index = 2;
  while (names.includes(`Untitled ${index}`)) index += 1;
  return `Untitled ${index}`;
}

export function isDirty(current: string, saved: string): boolean {
  return current !== saved;
}

export function windowTitle(name: string | null, dirty: boolean): string {
  if (name === null) return "Text Editor";
  return `${dirty ? "• " : ""}${name} — Text Editor`;
}

export function pushRecent(list: string[], path: string, cap = 10): string[] {
  return [path, ...list.filter((item) => item !== path)].slice(0, cap);
}
