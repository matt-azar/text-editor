import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chordLookup,
  chordParts,
  conflictingCommands,
  DEFAULT_BINDINGS,
  formatChord,
  isAbandonedDefault,
  normalizeChordString,
  normalizeOverrides,
  overridesFromBindings,
  readShortcutOverrides,
  resolveBindings,
  writeShortcutOverrides,
} from "./shortcuts.ts";

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length(): number {
    return this.data.size;
  }
  clear(): void {
    this.data.clear();
  }
  getItem(key: string): string | null {
    return this.data.has(key) ? this.data.get(key)! : null;
  }
  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

test("normalizeChordString canonicalizes modifiers and keys", () => {
  assert.equal(normalizeChordString("ctrl+n"), "Ctrl+N");
  assert.equal(normalizeChordString("Cmd+Shift+s"), "Ctrl+Shift+S");
  assert.equal(normalizeChordString("alt+arrowup"), "Alt+ArrowUp");
  assert.equal(normalizeChordString("Ctrl++"), "Ctrl++");
  assert.equal(normalizeChordString("Ctrl+−"), "Ctrl+-");
  assert.equal(normalizeChordString("n"), null);
});

test("resolveBindings applies overrides and null clears", () => {
  const bindings = resolveBindings({ "file.new": "Ctrl+Shift+N", "edit.find": null });
  assert.equal(bindings["file.new"], "Ctrl+Shift+N");
  assert.equal(bindings["edit.find"], null);
  assert.equal(bindings["file.save"], "Ctrl+S");
});

test("conflictingCommands flags shared chords", () => {
  const bindings = resolveBindings({ "file.open": "Ctrl+N" });
  const conflicts = conflictingCommands(bindings);
  assert.equal(conflicts.has("file.new"), true);
  assert.equal(conflicts.has("file.open"), true);
  assert.equal(conflicts.has("file.save"), false);
});

test("chordLookup keeps the first COMMAND_DEFS winner on conflict", () => {
  const bindings = resolveBindings({ "file.open": "Ctrl+N" });
  assert.equal(chordLookup(bindings).get("Ctrl+N"), "file.new");
});

test("isAbandonedDefault detects rebound defaults", () => {
  const bindings = resolveBindings({ "file.new": "Ctrl+Shift+N" });
  assert.equal(isAbandonedDefault("Ctrl+N", bindings), true);
  assert.equal(isAbandonedDefault("Ctrl+S", bindings), false);
});

test("formatChord and chordParts handle plus and minus", () => {
  assert.deepEqual(chordParts("Ctrl++"), ["Ctrl", "+"]);
  assert.deepEqual(chordParts("Ctrl+-"), ["Ctrl", "-"]);
  assert.equal(formatChord("Ctrl+-"), "Ctrl+−");
  assert.equal(formatChord(null), "");
});

test("shortcut overrides round-trip and drop defaults", () => {
  const storage = new MemoryStorage();
  const overrides = normalizeOverrides({ "view.zen": "Ctrl+Shift+E", "nope": "Ctrl+X" });
  writeShortcutOverrides(storage, overrides);
  assert.deepEqual(readShortcutOverrides(storage), { "view.zen": "Ctrl+Shift+E" });

  const bindings = resolveBindings(overrides);
  assert.deepEqual(overridesFromBindings(bindings), { "view.zen": "Ctrl+Shift+E" });
  assert.deepEqual(overridesFromBindings(DEFAULT_BINDINGS), {});
  writeShortcutOverrides(storage, {});
  assert.equal(storage.getItem("text-editor-shortcuts"), null);
});
