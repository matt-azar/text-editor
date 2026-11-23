import { LanguageDescription, type LanguageSupport } from "@codemirror/language";
import { languages as packedLanguages } from "@codemirror/language-data";
import type { Extension } from "@codemirror/state";
import { fileName } from "./state.ts";

/** Load a packed language by name; used for filename aliases not covered by language-data. */
function loadPacked(name: string): Promise<LanguageSupport> {
  const desc = LanguageDescription.matchLanguageName(packedLanguages, name, true);
  if (!desc) {
    return Promise.reject(new Error(`Missing packed language: ${name}`));
  }
  return desc.load();
}

/** Lazy Zig support (not in `@codemirror/language-data`). */
function loadZig(): Promise<LanguageSupport> {
  return import("codemirror-lang-zig").then((mod) => mod.zig());
}

/**
 * Extra languages / filename aliases ahead of `@codemirror/language-data`.
 * C and C++ come from the pack; Zig, Makefile, Dockerfile variants, and a few
 * shell extensions are wired here.
 */
const extras: LanguageDescription[] = [
  LanguageDescription.of({
    name: "Zig",
    alias: ["zig"],
    extensions: ["zig", "zon"],
    load: () => loadZig(),
  }),
  LanguageDescription.of({
    name: "Makefile",
    alias: ["make"],
    filename: /^(GNU|BSD)?[Mm]akefile$/,
    load: () => loadPacked("Shell"),
  }),
  LanguageDescription.of({
    name: "Dockerfile",
    alias: ["docker"],
    filename: /^Dockerfile([.-].*)?$/i,
    load: () => loadPacked("Dockerfile"),
  }),
  LanguageDescription.of({
    name: "Shell",
    extensions: ["zsh", "fish", "bashrc", "zshrc"],
    load: () => loadPacked("Shell"),
  }),
];

const languages: readonly LanguageDescription[] = [...extras, ...packedLanguages];

/** Basename used for language matching (path or tab name). */
export function languageFileName(pathOrName: string | null | undefined): string | null {
  if (!pathOrName) return null;
  const name = fileName(pathOrName).trim();
  return name || null;
}

/** Language metadata for a path or filename, or null for plain text. */
export function languageForPath(pathOrName: string | null | undefined): LanguageDescription | null {
  const name = languageFileName(pathOrName);
  if (!name) return null;
  return LanguageDescription.matchFilename(languages, name) ?? null;
}

/** CodeMirror language support for a path, or `[]` when unknown / plain text. */
export async function languageSupportForPath(pathOrName: string | null | undefined): Promise<Extension> {
  const desc = languageForPath(pathOrName);
  if (!desc) return [];
  return desc.load();
}
