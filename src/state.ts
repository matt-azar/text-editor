export type LineEnding = "lf" | "crlf";

export type StoredEditorSettings = {
  fontFamily: FontFamilyId;
  fontSize: number;
  wordWrap: boolean;
  lineNumbers: boolean;
  tabSize: number;
  highlightCurrentLine: boolean;
  caretBlink: boolean;
  caretWidth: CaretWidth;
  vimMode: boolean;
};

export type StoredChromeSettings = {
  showTabs: boolean;
  showStatusBar: boolean;
  lightMode: boolean;
};

export const DEFAULT_EDITOR_SETTINGS: StoredEditorSettings = {
  fontFamily: "cascadia-code",
  fontSize: 14,
  wordWrap: true,
  lineNumbers: true,
  tabSize: 4,
  highlightCurrentLine: true,
  caretBlink: true,
  caretWidth: 2,
  vimMode: false,
};

export const DEFAULT_CHROME_SETTINGS: StoredChromeSettings = {
  showTabs: true,
  showStatusBar: true,
  lightMode: false,
};

export const TAB_SIZE_OPTIONS = [2, 4, 8] as const;
/** Line caret widths in CSS pixels, plus a one-character block. 2 matches VS Code / Cursor’s thicker default feel. */
export const CARET_WIDTH_OPTIONS = [1, 2, 3, "block"] as const;
export type CaretWidth = (typeof CARET_WIDTH_OPTIONS)[number];

/** Editor typeface choices. Stacks prefer Windows fonts, then cross-platform monospace fallbacks. */
export const FONT_OPTIONS = [
  { id: "cascadia-code", label: "Cascadia Code", accel: "a", stack: '"Cascadia Code", "Cascadia Mono", Consolas, monospace' },
  { id: "cascadia-mono", label: "Cascadia Mono", accel: "m", stack: '"Cascadia Mono", "Cascadia Code", Consolas, monospace' },
  { id: "consolas", label: "Consolas", accel: "n", stack: 'Consolas, "Courier New", monospace' },
  { id: "courier-new", label: "Courier New", accel: "u", stack: '"Courier New", Courier, monospace' },
  { id: "lucida-console", label: "Lucida Console", accel: "l", stack: '"Lucida Console", Monaco, monospace' },
  { id: "fixedsys", label: "Fixedsys", accel: "x", stack: "Fixedsys, Terminal, monospace" },
  { id: "terminal", label: "Terminal", accel: "t", stack: "Terminal, Fixedsys, monospace" },
  { id: "segoe-ui-mono", label: "Segoe UI Mono", accel: "s", stack: '"Segoe UI Mono", Consolas, monospace' },
  { id: "jetbrains-mono", label: "JetBrains Mono", accel: "j", stack: '"JetBrains Mono", Consolas, monospace' },
  { id: "fira-code", label: "Fira Code", accel: "f", stack: '"Fira Code", Consolas, monospace' },
  { id: "source-code-pro", label: "Source Code Pro", accel: "r", stack: '"Source Code Pro", Consolas, monospace' },
  { id: "ibm-plex-mono", label: "IBM Plex Mono", accel: "i", stack: '"IBM Plex Mono", Consolas, monospace' },
] as const;

export type FontFamilyId = (typeof FONT_OPTIONS)[number]["id"];

export function normalizeTabSize(value: unknown): number {
  const size = typeof value === "number" ? value : Number(value);
  return TAB_SIZE_OPTIONS.includes(size as (typeof TAB_SIZE_OPTIONS)[number]) ? size : DEFAULT_EDITOR_SETTINGS.tabSize;
}

export function normalizeCaretWidth(value: unknown): CaretWidth {
  if (value === "block") return "block";
  const width = typeof value === "number" ? value : Number(value);
  return CARET_WIDTH_OPTIONS.includes(width as CaretWidth) ? (width as CaretWidth) : DEFAULT_EDITOR_SETTINGS.caretWidth;
}

export function normalizeFontFamily(value: unknown): FontFamilyId {
  if (typeof value === "string" && FONT_OPTIONS.some((option) => option.id === value)) {
    return value as FontFamilyId;
  }
  return DEFAULT_EDITOR_SETTINGS.fontFamily;
}

export function fontStackFor(id: FontFamilyId): string {
  return FONT_OPTIONS.find((option) => option.id === id)?.stack ?? FONT_OPTIONS[0].stack;
}

/** Accepts the current caret fields and the older cursor/thick names. */
type RawEditorSettings = Partial<Omit<StoredEditorSettings, "caretWidth" | "caretBlink" | "fontFamily">> & {
  fontFamily?: unknown;
  caretWidth?: unknown;
  caretBlink?: boolean;
  cursorWidth?: unknown;
  cursorBlink?: boolean;
  thickCursor?: boolean;
};

export function normalizeEditorSettings(raw: RawEditorSettings | null | undefined): StoredEditorSettings {
  const font = Number(raw?.fontSize);
  const blink = raw?.caretBlink !== undefined ? raw.caretBlink : raw?.cursorBlink;
  return {
    fontFamily: normalizeFontFamily(raw?.fontFamily),
    fontSize: font >= 10 && font <= 32 ? font : DEFAULT_EDITOR_SETTINGS.fontSize,
    wordWrap: raw?.wordWrap !== false,
    lineNumbers: raw?.lineNumbers !== false,
    tabSize: normalizeTabSize(raw?.tabSize),
    highlightCurrentLine: raw?.highlightCurrentLine !== false,
    caretBlink: blink !== false,
    caretWidth: raw?.thickCursor === true ? "block" : normalizeCaretWidth(raw?.caretWidth ?? raw?.cursorWidth),
    vimMode: raw?.vimMode === true,
  };
}

export function normalizeChromeSettings(raw: Partial<StoredChromeSettings> | null | undefined): StoredChromeSettings {
  return {
    showTabs: raw?.showTabs !== false,
    showStatusBar: raw?.showStatusBar !== false,
    lightMode: raw?.lightMode === true,
  };
}

/** Read editor settings from localStorage, migrating legacy single-key values. */
export function readEditorSettings(storage: Storage): StoredEditorSettings {
  try {
    const packed = storage.getItem("text-editor-settings");
    if (packed) {
      return normalizeEditorSettings(JSON.parse(packed) as Partial<StoredEditorSettings>);
    }
  } catch {
    // Fall through to legacy keys.
  }
  return normalizeEditorSettings({
    fontFamily: storage.getItem("text-editor-font-family") ?? undefined,
    fontSize: Number(storage.getItem("text-editor-font")),
    wordWrap: storage.getItem("text-editor-wrap") !== "off",
    lineNumbers: storage.getItem("text-editor-gutter") !== "off",
    tabSize: Number(storage.getItem("text-editor-tab-size")),
    highlightCurrentLine: storage.getItem("text-editor-active-line") !== "off",
    caretBlink: (storage.getItem("text-editor-caret-blink") ?? storage.getItem("text-editor-cursor-blink")) !== "off",
    caretWidth: (storage.getItem("text-editor-caret-width") ?? storage.getItem("text-editor-cursor-width")) === "block"
      ? "block"
      : Number(storage.getItem("text-editor-caret-width") ?? storage.getItem("text-editor-cursor-width")),
    vimMode: storage.getItem("text-editor-vim") === "on",
    thickCursor: storage.getItem("text-editor-thick-cursor") === "on",
  });
}

export function writeEditorSettings(storage: Storage, settings: StoredEditorSettings): void {
  storage.setItem("text-editor-settings", JSON.stringify(normalizeEditorSettings(settings)));
  // Keep legacy keys in sync for older builds.
  storage.setItem("text-editor-font-family", settings.fontFamily);
  storage.setItem("text-editor-font", String(settings.fontSize));
  storage.setItem("text-editor-wrap", settings.wordWrap ? "on" : "off");
  storage.setItem("text-editor-gutter", settings.lineNumbers ? "on" : "off");
  storage.setItem("text-editor-tab-size", String(settings.tabSize));
  storage.setItem("text-editor-active-line", settings.highlightCurrentLine ? "on" : "off");
  storage.setItem("text-editor-caret-blink", settings.caretBlink ? "on" : "off");
  storage.setItem("text-editor-caret-width", String(settings.caretWidth));
  storage.setItem("text-editor-vim", settings.vimMode ? "on" : "off");
}

export function readChromeSettings(storage: Storage): StoredChromeSettings {
  try {
    const packed = storage.getItem("text-editor-chrome");
    if (packed) {
      return normalizeChromeSettings(JSON.parse(packed) as Partial<StoredChromeSettings>);
    }
  } catch {
    // Fall through to legacy keys.
  }
  return normalizeChromeSettings({
    showTabs: storage.getItem("text-editor-show-tabs") !== "off",
    showStatusBar: storage.getItem("text-editor-show-status") !== "off",
    lightMode: storage.getItem("text-editor-light") === "on",
  });
}

export function writeChromeSettings(storage: Storage, chrome: StoredChromeSettings): void {
  storage.setItem("text-editor-chrome", JSON.stringify(normalizeChromeSettings(chrome)));
  storage.setItem("text-editor-show-tabs", chrome.showTabs ? "on" : "off");
  storage.setItem("text-editor-show-status", chrome.showStatusBar ? "on" : "off");
  storage.setItem("text-editor-light", chrome.lightMode ? "on" : "off");
}

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

/** Cycle an open-tab index; returns -1 when there are no tabs. */
export function nextTabIndex(length: number, current: number, delta: number): number {
  if (length <= 0) return -1;
  const start = ((current % length) + length) % length;
  return (start + delta + length * 10) % length;
}
