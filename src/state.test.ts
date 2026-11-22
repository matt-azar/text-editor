import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fileName,
  isDirty,
  nextTabIndex,
  nextUntitled,
  normalizeChromeSettings,
  normalizeCaretWidth,
  normalizeEditorSettings,
  normalizeFontFamily,
  normalizeTabSize,
  pushRecent,
  readChromeSettings,
  readEditorSettings,
  windowTitle,
  writeChromeSettings,
  writeEditorSettings,
} from "./state.ts";

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

test("fileName reads the last path segment", () => {
  assert.equal(fileName("C:\\notes\\today.txt"), "today.txt");
  assert.equal(fileName("/home/matt/today.txt"), "today.txt");
  assert.equal(fileName("today.txt"), "today.txt");
});

test("nextUntitled skips names already used", () => {
  assert.equal(nextUntitled([]), "Untitled");
  assert.equal(nextUntitled(["Untitled"]), "Untitled 2");
  assert.equal(nextUntitled(["Untitled", "Untitled 2"]), "Untitled 3");
});

test("isDirty compares the buffer to the saved text", () => {
  assert.equal(isDirty("a", "a"), false);
  assert.equal(isDirty("a\n", "a"), true);
});

test("windowTitle marks a dirty document and an empty window", () => {
  assert.equal(windowTitle(null, false), "Text Editor");
  assert.equal(windowTitle("notes.txt", false), "notes.txt — Text Editor");
  assert.equal(windowTitle("Untitled", true), "• Untitled — Text Editor");
});

test("pushRecent moves a duplicate to the front and caps the list", () => {
  const first = pushRecent(["a", "b"], "c");
  assert.deepEqual(first, ["c", "a", "b"]);
  const again = pushRecent(first, "a");
  assert.deepEqual(again, ["a", "c", "b"]);
  const many = Array.from({ length: 12 }, (_, index) => `f${index}`);
  const capped = many.reduce((list, path) => pushRecent(list, path, 10), [] as string[]);
  assert.equal(capped.length, 10);
  assert.equal(capped[0], "f11");
  assert.equal(capped.includes("f0"), false);
});

test("nextTabIndex wraps around open tabs", () => {
  assert.equal(nextTabIndex(0, 0, 1), -1);
  assert.equal(nextTabIndex(3, 0, 1), 1);
  assert.equal(nextTabIndex(3, 2, 1), 0);
  assert.equal(nextTabIndex(3, 0, -1), 2);
});

test("normalizeTabSize only allows 2, 4, or 8", () => {
  assert.equal(normalizeTabSize(2), 2);
  assert.equal(normalizeTabSize(4), 4);
  assert.equal(normalizeTabSize(8), 8);
  assert.equal(normalizeTabSize(3), 4);
  assert.equal(normalizeTabSize("nope"), 4);
});

test("normalizeCaretWidth only allows 1, 2, 3, or block", () => {
  assert.equal(normalizeCaretWidth(1), 1);
  assert.equal(normalizeCaretWidth(2), 2);
  assert.equal(normalizeCaretWidth(3), 3);
  assert.equal(normalizeCaretWidth("block"), "block");
  assert.equal(normalizeCaretWidth(4), 2);
  assert.equal(normalizeCaretWidth("nope"), 2);
});

test("normalizeFontFamily only allows known typefaces", () => {
  assert.equal(normalizeFontFamily("consolas"), "consolas");
  assert.equal(normalizeFontFamily("fira-code"), "fira-code");
  assert.equal(normalizeFontFamily("fixedsys"), "fixedsys");
  assert.equal(normalizeFontFamily("terminal"), "terminal");
  assert.equal(normalizeFontFamily("dos-ega"), "dos-ega");
  assert.equal(normalizeFontFamily("press-start-2p"), "press-start-2p");
  assert.equal(normalizeFontFamily("nope"), "cascadia-code");
  assert.equal(normalizeFontFamily(undefined), "cascadia-code");
});

test("normalizeEditorSettings fills defaults", () => {
  assert.deepEqual(normalizeEditorSettings({}), {
    fontFamily: "cascadia-code",
    fontSize: 14,
    wordWrap: true,
    lineNumbers: true,
    tabSize: 4,
    highlightCurrentLine: true,
    caretBlink: true,
    caretWidth: 2,
    vimMode: false,
  });
  assert.equal(normalizeEditorSettings({ fontSize: 18, wordWrap: false, tabSize: 2 }).fontSize, 18);
  assert.equal(normalizeEditorSettings({ fontSize: 18, wordWrap: false, tabSize: 2 }).wordWrap, false);
  assert.equal(normalizeEditorSettings({ fontSize: 18, wordWrap: false, tabSize: 2 }).tabSize, 2);
  assert.equal(normalizeEditorSettings({ fontFamily: "jetbrains-mono" }).fontFamily, "jetbrains-mono");
  assert.equal(normalizeEditorSettings({ highlightCurrentLine: false }).highlightCurrentLine, false);
  assert.equal(normalizeEditorSettings({ caretBlink: false }).caretBlink, false);
  assert.equal(normalizeEditorSettings({ caretWidth: 3 }).caretWidth, 3);
  assert.equal(normalizeEditorSettings({ caretWidth: "block" }).caretWidth, "block");
  assert.equal(normalizeEditorSettings({ vimMode: true }).vimMode, true);
  assert.equal(normalizeEditorSettings({ cursorBlink: false }).caretBlink, false);
  assert.equal(normalizeEditorSettings({ thickCursor: true, cursorWidth: 1 }).caretWidth, "block");
});

test("editor settings round-trip through storage", () => {
  const storage = new MemoryStorage();
  writeEditorSettings(storage, {
    fontFamily: "fira-code",
    fontSize: 16,
    wordWrap: false,
    lineNumbers: false,
    tabSize: 2,
    highlightCurrentLine: false,
    caretBlink: false,
    caretWidth: "block",
    vimMode: true,
  });
  assert.deepEqual(readEditorSettings(storage), {
    fontFamily: "fira-code",
    fontSize: 16,
    wordWrap: false,
    lineNumbers: false,
    tabSize: 2,
    highlightCurrentLine: false,
    caretBlink: false,
    caretWidth: "block",
    vimMode: true,
  });
});

test("editor settings migrate legacy localStorage keys", () => {
  const storage = new MemoryStorage();
  storage.setItem("text-editor-font-family", "consolas");
  storage.setItem("text-editor-font", "18");
  storage.setItem("text-editor-wrap", "off");
  storage.setItem("text-editor-gutter", "off");
  storage.setItem("text-editor-tab-size", "8");
  storage.setItem("text-editor-active-line", "off");
  storage.setItem("text-editor-cursor-blink", "off");
  storage.setItem("text-editor-cursor-width", "1");
  storage.setItem("text-editor-vim", "on");
  storage.setItem("text-editor-thick-cursor", "on");
  assert.deepEqual(readEditorSettings(storage), {
    fontFamily: "consolas",
    fontSize: 18,
    wordWrap: false,
    lineNumbers: false,
    tabSize: 8,
    highlightCurrentLine: false,
    caretBlink: false,
    caretWidth: "block",
    vimMode: true,
  });
});

test("chrome settings persist between writes", () => {
  const storage = new MemoryStorage();
  writeChromeSettings(storage, { showTabs: false, showStatusBar: true, lightMode: true });
  assert.deepEqual(readChromeSettings(storage), { showTabs: false, showStatusBar: true, lightMode: true });
  assert.equal(normalizeChromeSettings({}).lightMode, false);
});
