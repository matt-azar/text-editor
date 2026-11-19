export type LineEnding = "lf" | "crlf";

export type StoredEditorSettings = {
  fontSize: number;
  wordWrap: boolean;
  lineNumbers: boolean;
  tabSize: number;
};

export type StoredChromeSettings = {
  showTabs: boolean;
  showStatusBar: boolean;
};

export const DEFAULT_EDITOR_SETTINGS: StoredEditorSettings = {
  fontSize: 14,
  wordWrap: true,
  lineNumbers: true,
  tabSize: 4,
};

export const DEFAULT_CHROME_SETTINGS: StoredChromeSettings = {
  showTabs: true,
  showStatusBar: true,
};

export const TAB_SIZE_OPTIONS = [2, 4, 8] as const;

export function normalizeTabSize(value: unknown): number {
  const size = typeof value === "number" ? value : Number(value);
  return TAB_SIZE_OPTIONS.includes(size as (typeof TAB_SIZE_OPTIONS)[number]) ? size : DEFAULT_EDITOR_SETTINGS.tabSize;
}

export function normalizeEditorSettings(raw: Partial<StoredEditorSettings> | null | undefined): StoredEditorSettings {
  const font = Number(raw?.fontSize);
  return {
    fontSize: font >= 10 && font <= 32 ? font : DEFAULT_EDITOR_SETTINGS.fontSize,
    wordWrap: raw?.wordWrap !== false,
    lineNumbers: raw?.lineNumbers !== false,
    tabSize: normalizeTabSize(raw?.tabSize),
  };
}

export function normalizeChromeSettings(raw: Partial<StoredChromeSettings> | null | undefined): StoredChromeSettings {
  return {
    showTabs: raw?.showTabs !== false,
    showStatusBar: raw?.showStatusBar !== false,
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
    fontSize: Number(storage.getItem("text-editor-font")),
    wordWrap: storage.getItem("text-editor-wrap") !== "off",
    lineNumbers: storage.getItem("text-editor-gutter") !== "off",
    tabSize: Number(storage.getItem("text-editor-tab-size")),
  });
}

export function writeEditorSettings(storage: Storage, settings: StoredEditorSettings): void {
  storage.setItem("text-editor-settings", JSON.stringify(normalizeEditorSettings(settings)));
  // Keep legacy keys in sync for older builds.
  storage.setItem("text-editor-font", String(settings.fontSize));
  storage.setItem("text-editor-wrap", settings.wordWrap ? "on" : "off");
  storage.setItem("text-editor-gutter", settings.lineNumbers ? "on" : "off");
  storage.setItem("text-editor-tab-size", String(settings.tabSize));
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
  });
}

export function writeChromeSettings(storage: Storage, chrome: StoredChromeSettings): void {
  storage.setItem("text-editor-chrome", JSON.stringify(normalizeChromeSettings(chrome)));
  storage.setItem("text-editor-show-tabs", chrome.showTabs ? "on" : "off");
  storage.setItem("text-editor-show-status", chrome.showStatusBar ? "on" : "off");
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
