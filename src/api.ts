import { invoke } from "@tauri-apps/api/core";
import type { LineEnding } from "./state.ts";

export type TextDocument = {
  text: string;
  lineEnding: LineEnding;
};

export function readText(path: string): Promise<TextDocument> {
  return invoke<TextDocument>("read_text", { path });
}

export function writeText(path: string, text: string, lineEnding: LineEnding): Promise<void> {
  return invoke("write_text", { path, text, lineEnding });
}

export function pickOpenPath(): Promise<string | null> {
  return invoke<string | null>("pick_open_path");
}

export function pickSavePath(suggestedName: string): Promise<string | null> {
  return invoke<string | null>("pick_save_path", { suggestedName });
}

export function loadRecent(): Promise<string[]> {
  return invoke<string[]>("load_recent");
}

export function rememberRecent(path: string): Promise<string[]> {
  return invoke<string[]>("remember_recent", { path });
}

export function forgetRecent(path: string): Promise<string[]> {
  return invoke<string[]>("forget_recent", { path });
}

export function defaultLineEnding(): Promise<LineEnding> {
  return invoke<LineEnding>("default_line_ending");
}

export function startupFiles(): Promise<string[]> {
  return invoke<string[]>("startup_files");
}

export function errorText(error: unknown): string {
  if (typeof error === "string" && error.trim()) return error;
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong.";
}
