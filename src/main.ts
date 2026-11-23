import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  defaultLineEnding,
  errorText,
  forgetRecent,
  loadRecent,
  pickOpenPath,
  pickSavePath,
  readText,
  rememberRecent,
  startupFiles,
  writeText,
} from "./api.ts";
import {
  applyLanguage,
  applySettings,
  copySelection,
  createDocument,
  caretPosition,
  duplicateLines,
  ensureVimLoaded,
  moveLines,
  openFind,
  openReplace,
  pasteClipboard,
  retarget,
  retargetLanguage,
  runRedo,
  runSelectAll,
  runUndo,
  type EditorSettings,
} from "./editor.ts";
import { languageSupportForPath } from "./language.ts";
import {
  chordFromEvent,
  chordLookup,
  COMMAND_DEFS,
  conflictingCommands,
  displayParts,
  EMPTY_SCREEN_COMMANDS,
  formatChord,
  isAbandonedDefault,
  overridesFromBindings,
  readShortcutOverrides,
  resolveBindings,
  writeShortcutOverrides,
  type CommandId,
  type ShortcutBindings,
} from "./shortcuts.ts";
import {
  fileName,
  isDirty,
  nextTabIndex,
  nextUntitled,
  readChromeSettings,
  readEditorSettings,
  CARET_WIDTH_OPTIONS,
  EDITOR_PADDING_OPTIONS,
  FONT_OPTIONS,
  LINE_SPACING_OPTIONS,
  TAB_SIZE_OPTIONS,
  windowTitle,
  writeChromeSettings,
  writeEditorSettings,
  type FontFamilyId,
  type LineEnding,
} from "./state.ts";

type Tab = {
  id: string;
  path: string | null;
  name: string;
  lineEnding: LineEnding;
  savedText: string;
  doc: EditorState;
  dirty: boolean;
  /** Bumps when language should reload; stale async loads are ignored. */
  languageSeq: number;
};

type MenuItem = {
  label: string;
  accel: string;
  shortcut?: string;
  enabled: boolean;
  checked?: boolean;
  children?: MenuItem[];
  run?: () => unknown;
};

type DialogButton = {
  label: string;
  value: string;
};

let bindings: ShortcutBindings = resolveBindings(readShortcutOverrides(localStorage));
let bindingLookup = chordLookup(bindings);
/** When set, the shortcuts editor is capturing the next chord for this command. */
let recordingCommand: CommandId | null = null;
/** Repaint callback while the shortcuts editor dialog is open. */
let paintShortcutEditor: (() => void) | null = null;

function saveBindings(next: ShortcutBindings): void {
  bindings = next;
  bindingLookup = chordLookup(bindings);
  writeShortcutOverrides(localStorage, overridesFromBindings(bindings));
}

function chordHint(id: CommandId): string | undefined {
  const chord = bindings[id];
  return chord ? formatChord(chord) : undefined;
}

function emptyScreenShortcuts(): { label: string; keys: string[] }[] {
  return EMPTY_SCREEN_COMMANDS.flatMap((id) => {
    const def = COMMAND_DEFS.find((command) => command.id === id);
    const chord = bindings[id];
    if (!def || !chord) return [];
    return [{ label: def.label, keys: displayParts(chord) }];
  });
}

function helpShortcutRows(): { label: string; keys: string[] }[] {
  return COMMAND_DEFS.flatMap((command) => {
    const chord = bindings[command.id];
    if (!chord) return [];
    return [{ label: command.label, keys: displayParts(chord) }];
  });
}

function refreshEmptyShortcuts(): void {
  const host = document.querySelector("#shortcuts") as HTMLElement | null;
  if (host) renderShortcuts(host, emptyScreenShortcuts());
}

const titlebarEl = document.querySelector("#titlebar") as HTMLElement;
const tabsEl = document.querySelector("#tabs") as HTMLElement;
const emptyEl = document.querySelector("#empty") as HTMLElement;
const editorEl = document.querySelector("#editor") as HTMLElement;
const statusEl = document.querySelector("#status") as HTMLElement;
const statusPath = document.querySelector("#status-path") as HTMLElement;
const statusPos = document.querySelector("#status-pos") as HTMLElement;
const statusEnding = document.querySelector("#status-ending") as HTMLElement;
const statusVim = document.querySelector("#status-vim") as HTMLElement;
const menubar = document.querySelector("#menubar") as HTMLElement;
const modal = document.querySelector("#modal") as HTMLElement;
const maxButton = document.querySelector("#win-max") as HTMLButtonElement;
const zenDragEl = document.querySelector("#zen-drag") as HTMLElement;

const tabs: Tab[] = [];
let activeId: string | null = null;
let view: EditorView | null = null;
let recent: string[] = [];
let defaultEnding: LineEnding = "lf";
let menuName: string | null = null;
let menuIndex = 0;
let altAlone = false;
let closing = false;
/** Session-only: hide titlebar, tabs, and status for a naked editor. */
let zenMode = false;

type ChromeSettings = {
  showTabs: boolean;
  showStatusBar: boolean;
  lightMode: boolean;
};

const settings: EditorSettings = readEditorSettings(localStorage);
const chrome: ChromeSettings = readChromeSettings(localStorage);

function applyAppTheme(): void {
  document.documentElement.dataset.theme = chrome.lightMode ? "light" : "dark";
}

function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function saveSettings(): void {
  writeEditorSettings(localStorage, settings);
}

function saveChrome(): void {
  writeChromeSettings(localStorage, chrome);
}

function activeTab(): Tab | null {
  return tabs.find((tab) => tab.id === activeId) ?? null;
}

function requireView(): EditorView | null {
  const tab = activeTab();
  if (!tab || !view) return null;
  view.focus();
  return view;
}

function onEditorUpdate(state: EditorState): void {
  const tab = activeTab();
  if (!tab) return;
  tab.doc = state;
  const dirty = isDirty(state.doc.toString(), tab.savedText);
  const changed = dirty !== tab.dirty;
  tab.dirty = dirty;
  paintStatus(tab);
  const button = tabsEl.querySelector<HTMLElement>(`[data-tab="${tab.id}"] .dirty`);
  if (button) button.hidden = !dirty;
  if (changed) void syncTitle();
}

function createTab(name: string, text: string, path: string | null, lineEnding: LineEnding): Tab {
  const tab: Tab = {
    id: crypto.randomUUID(),
    path,
    name,
    lineEnding,
    savedText: text,
    doc: createDocument(text, settings, onEditorUpdate, chrome.lightMode),
    dirty: false,
    languageSeq: 0,
  };
  void refreshLanguage(tab);
  return tab;
}

/** Detect language from path/name and attach highlighting; no-op for plain text. */
async function refreshLanguage(tab: Tab): Promise<void> {
  const seq = ++tab.languageSeq;
  const support = await languageSupportForPath(tab.path ?? tab.name);
  if (tab.languageSeq !== seq) return;
  if (view && tab.id === activeId) {
    tab.doc = applyLanguage(view, support);
  } else {
    tab.doc = retargetLanguage(tab.doc, support);
  }
}

function showTab(tab: Tab): void {
  activeId = tab.id;
  editorEl.hidden = false;
  if (!view) {
    view = new EditorView({ parent: editorEl, state: tab.doc });
  } else if (view.state !== tab.doc) {
    view.setState(tab.doc);
  }
  view.dispatch({ effects: [] });
  tab.doc = applySettings(view, settings, chrome.lightMode);
  paintStatus(tab);
  view.focus();
}

function renderTabs(): void {
  tabsEl.replaceChildren();
  for (const tab of tabs) {
    const button = document.createElement("div");
    button.className = `tab${tab.id === activeId ? " active" : ""}`;
    button.dataset.tab = tab.id;
    const name = document.createElement("span");
    name.className = "tab-name";
    name.textContent = tab.name;
    const dirty = document.createElement("span");
    dirty.className = "dirty";
    dirty.hidden = !tab.dirty;
    const close = document.createElement("button");
    close.type = "button";
    close.className = "tab-close";
    close.setAttribute("aria-label", `Close ${tab.name}`);
    close.textContent = "×";
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      void closeTab(tab);
    });
    button.addEventListener("click", () => {
      activate(tab.id);
    });
    button.addEventListener("auxclick", (event) => {
      if (event.button === 1) {
        event.preventDefault();
        void closeTab(tab);
      }
    });
    button.append(name, dirty, close);
    tabsEl.append(button);
  }
}

function renderChrome(): void {
  const hasTabs = tabs.length > 0;
  document.body.classList.toggle("zen", zenMode);
  titlebarEl.hidden = zenMode;
  emptyEl.hidden = hasTabs;
  tabsEl.hidden = zenMode || !(hasTabs && chrome.showTabs);
  statusEl.hidden = zenMode || !(hasTabs && chrome.showStatusBar);
  editorEl.hidden = !hasTabs;
  zenDragEl.hidden = !zenMode;
  zenDragEl.setAttribute("aria-hidden", zenMode ? "false" : "true");
  if (zenMode) closeMenu();
  renderTabs();
  const tab = activeTab();
  if (tab) paintStatus(tab);
  void syncTitle();
  if (zenMode && hasTabs) view?.focus();
}

function toggleZenMode(): void {
  zenMode = !zenMode;
  renderChrome();
}

function cycleTab(delta: number): void {
  if (tabs.length === 0) return;
  const current = tabs.findIndex((tab) => tab.id === activeId);
  const next = nextTabIndex(tabs.length, current < 0 ? 0 : current, delta);
  if (next < 0) return;
  const tab = tabs[next];
  if (tab) activate(tab.id);
}

function toggleShowTabs(): void {
  chrome.showTabs = !chrome.showTabs;
  saveChrome();
  renderChrome();
}

function toggleShowStatusBar(): void {
  chrome.showStatusBar = !chrome.showStatusBar;
  saveChrome();
  renderChrome();
}

function toggleLightMode(): void {
  chrome.lightMode = !chrome.lightMode;
  saveChrome();
  applyAppTheme();
  pushSettings();
}

async function toggleVimMode(): Promise<void> {
  settings.vimMode = !settings.vimMode;
  if (settings.vimMode) await prepareVim();
  saveSettings();
  pushSettings();
  const tab = activeTab();
  if (tab) paintStatus(tab);
}

function paintStatus(tab: Tab): void {
  const position = caretPosition(tab.doc);
  statusPath.textContent = tab.path ?? "Untitled";
  statusPos.textContent = `Ln ${position.line}, Col ${position.column}`;
  statusEnding.textContent = tab.lineEnding === "crlf" ? "CRLF" : "LF";
  statusVim.hidden = !settings.vimMode;
  statusVim.textContent = settings.vimMode ? "Vim" : "";
}

async function syncTitle(): Promise<void> {
  const tab = activeTab();
  const title = windowTitle(tab?.name ?? null, tab?.dirty ?? false);
  document.title = title;
  if (!inTauri()) return;
  await getCurrentWindow().setTitle(title);
}

function activate(id: string): void {
  const tab = tabs.find((item) => item.id === id);
  if (!tab) return;
  showTab(tab);
  renderChrome();
}

function newFile(): void {
  const tab = createTab(nextUntitled(tabs.map((item) => item.name)), "", null, defaultEnding);
  tabs.push(tab);
  showTab(tab);
  renderChrome();
}

async function openPath(path: string): Promise<void> {
  const existing = tabs.find((tab) => tab.path === path);
  if (existing) {
    activate(existing.id);
    return;
  }
  try {
    const document = await readText(path);
    const tab = createTab(fileName(path), document.text, path, document.lineEnding);
    tabs.push(tab);
    showTab(tab);
    recent = await rememberRecent(path);
    renderChrome();
  } catch (error) {
    await showError(errorText(error));
    try {
      recent = await forgetRecent(path);
    } catch {
      recent = recent.filter((item) => item !== path);
    }
  }
}

async function openFile(): Promise<void> {
  try {
    const path = await pickOpenPath();
    if (path) await openPath(path);
  } catch (error) {
    await showError(errorText(error));
  }
}

/** Open the top of the recent-files list (MRU). No-op when the list is empty. */
async function openMostRecent(): Promise<void> {
  const path = recent[0];
  if (!path) return;
  await openPath(path);
}

function suggestedName(tab: Tab): string {
  if (tab.path) return fileName(tab.path);
  return tab.name.toLowerCase().endsWith(".txt") ? tab.name : `${tab.name}.txt`;
}

async function saveTab(tab: Tab, saveAs: boolean): Promise<boolean> {
  try {
    let path = saveAs ? null : tab.path;
    if (!path) {
      const picked = await pickSavePath(suggestedName(tab));
      if (!picked) return false;
      path = picked;
    }
    const text = tab.doc.doc.toString();
    await writeText(path, text, tab.lineEnding);
    const renamed = tab.path !== path || tab.name !== fileName(path);
    tab.path = path;
    tab.name = fileName(path);
    tab.savedText = text;
    tab.dirty = false;
    if (renamed) void refreshLanguage(tab);
    recent = await rememberRecent(path);
    renderChrome();
    return true;
  } catch (error) {
    await showError(errorText(error));
    return false;
  }
}

async function saveActive(saveAs = false): Promise<void> {
  const tab = activeTab();
  if (!tab) return;
  await saveTab(tab, saveAs);
}

async function closeTab(tab: Tab, force = false): Promise<boolean> {
  if (tab.dirty && !force) {
    activate(tab.id);
    const choice = await confirmSave(tab.name);
    if (choice === "cancel") return false;
    if (choice === "save") {
      const saved = await saveTab(tab, false);
      if (!saved) return false;
    }
  }
  const index = tabs.findIndex((item) => item.id === tab.id);
  if (index < 0) return true;
  tabs.splice(index, 1);
  if (tabs.length === 0) {
    activeId = null;
    view?.destroy();
    view = null;
  } else if (activeId === tab.id) {
    const next = tabs[Math.min(index, tabs.length - 1)];
    if (next) showTab(next);
  }
  renderChrome();
  return true;
}

async function confirmCloseAll(force = false): Promise<boolean> {
  if (force) {
    for (const tab of [...tabs]) {
      await closeTab(tab, true);
    }
    return true;
  }
  for (const tab of [...tabs]) {
    if (!tab.dirty) continue;
    const closed = await closeTab(tab);
    if (!closed) return false;
  }
  return true;
}

async function exitApp(force = false): Promise<void> {
  if (closing) return;
  if (!(await confirmCloseAll(force))) return;
  if (!inTauri()) return;
  closing = true;
  await getCurrentWindow().destroy();
}

async function saveAll(): Promise<boolean> {
  for (const tab of [...tabs]) {
    if (!tab.dirty) continue;
    const saved = await saveTab(tab, false);
    if (!saved) return false;
  }
  return true;
}

function exBang(params: { input?: string; argString?: string }): boolean {
  return /!/.test(params.input ?? "") || /^\s*!/.test(params.argString ?? "");
}

/** Path from `:e` / `:o` args; relative names resolve against the active tab’s folder. */
function exOpenPath(params: { argString?: string; args?: string[] }): string | null {
  const raw = (params.args?.length ? params.args.join(" ") : params.argString ?? "")
    .replace(/^!\s*/, "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .trim();
  if (!raw) return null;
  if (/^[a-zA-Z]:[\\/]/.test(raw) || raw.startsWith("\\\\") || raw.startsWith("/")) return raw;
  const base = activeTab()?.path;
  if (!base) return raw;
  const slash = base.includes("\\") ? "\\" : "/";
  const dir = base.slice(0, Math.max(base.lastIndexOf("/"), base.lastIndexOf("\\")));
  if (!dir) return raw;
  return `${dir}${slash}${raw}`;
}

let vimExReady = false;

/** Load Vim + wire :w / :q / :wq relatives (once). */
async function prepareVim(): Promise<void> {
  await ensureVimLoaded();
  if (vimExReady) return;
  const { Vim } = await import("@replit/codemirror-vim");
  const write = (): void => {
    void saveActive(false);
  };
  const quit = (params: { input?: string; argString?: string }): void => {
    const tab = activeTab();
    if (!tab) {
      void exitApp(exBang(params));
      return;
    }
    void closeTab(tab, exBang(params));
  };
  const writeQuit = (): void => {
    void (async () => {
      const tab = activeTab();
      if (!tab) {
        await exitApp();
        return;
      }
      if (tab.dirty) {
        const saved = await saveTab(tab, false);
        if (!saved) return;
      }
      await closeTab(tab, true);
    })();
  };
  const quitAll = (params: { input?: string; argString?: string }): void => {
    void exitApp(exBang(params));
  };
  const writeQuitAll = (): void => {
    void (async () => {
      if (!(await saveAll())) return;
      await exitApp(true);
    })();
  };

  const open = (params: { argString?: string; args?: string[] }): void => {
    const target = exOpenPath(params);
    if (!target) {
      void openFile();
      return;
    }
    void openPath(target);
  };

  Vim.defineEx("write", "w", write);
  Vim.defineEx("quit", "q", (_cm, params) => quit(params));
  Vim.defineEx("wq", "wq", writeQuit);
  Vim.defineEx("xit", "x", writeQuit);
  Vim.defineEx("exit", "exi", writeQuit);
  Vim.defineEx("qall", "qa", (_cm, params) => quitAll(params));
  Vim.defineEx("quitall", "quita", (_cm, params) => quitAll(params));
  Vim.defineEx("wqall", "wqa", writeQuitAll);
  Vim.defineEx("xall", "xa", writeQuitAll);
  Vim.defineEx("edit", "e", (_cm, params) => open(params));
  Vim.defineEx("open", "o", (_cm, params) => open(params));
  vimExReady = true;
}


function zoom(delta: number): void {
  settings.fontSize = delta === 0 ? 14 : Math.min(32, Math.max(10, settings.fontSize + delta));
  saveSettings();
  pushSettings();
}

function toggleWrap(): void {
  settings.wordWrap = !settings.wordWrap;
  saveSettings();
  pushSettings();
}

function toggleNumbers(): void {
  settings.lineNumbers = !settings.lineNumbers;
  saveSettings();
  pushSettings();
}

function toggleHighlightCurrentLine(): void {
  settings.highlightCurrentLine = !settings.highlightCurrentLine;
  saveSettings();
  pushSettings();
}

function toggleCaretBlink(): void {
  settings.caretBlink = !settings.caretBlink;
  saveSettings();
  pushSettings();
}

function setCaretWidth(width: (typeof CARET_WIDTH_OPTIONS)[number]): void {
  settings.caretWidth = width;
  saveSettings();
  pushSettings();
}

function setTabSize(size: number): void {
  settings.tabSize = size;
  saveSettings();
  pushSettings();
}

function toggleInsertSpaces(): void {
  settings.insertSpaces = !settings.insertSpaces;
  saveSettings();
  pushSettings();
}

function setLineSpacing(spacing: number): void {
  settings.lineSpacing = spacing;
  saveSettings();
  pushSettings();
}

function setEditorPadding(padding: number): void {
  settings.editorPadding = padding;
  saveSettings();
  pushSettings();
}

function setFontFamily(family: FontFamilyId): void {
  settings.fontFamily = family;
  saveSettings();
  pushSettings();
}

function pushSettings(): void {
  for (const tab of tabs) {
    if (view && tab.id === activeId) {
      tab.doc = applySettings(view, settings, chrome.lightMode);
    } else {
      tab.doc = retarget(tab.doc, settings, chrome.lightMode);
    }
  }
}

function withEditor(action: (editor: EditorView) => unknown): void {
  const editor = requireView();
  if (!editor) return;
  void Promise.resolve(action(editor)).catch((error: unknown) => {
    void showError(errorText(error));
  });
}

function menuItems(name: string): MenuItem[] {
  const hasTab = activeTab() !== null;
  if (name === "File") {
    const recentItems: MenuItem[] = recent.length
      ? recent.map((path) => ({
          label: fileName(path),
          accel: "",
          enabled: true,
          run: () => openPath(path),
        }))
      : [{ label: "No recent files", accel: "", enabled: false }];
    return [
      { label: "New", accel: "n", shortcut: chordHint("file.new"), enabled: true, run: newFile },
      { label: "Open…", accel: "o", shortcut: chordHint("file.open"), enabled: true, run: () => openFile() },
      { label: "Open Recent", accel: "r", shortcut: chordHint("file.recent"), enabled: recent.length > 0, children: recentItems },
      { label: "Save", accel: "s", shortcut: chordHint("file.save"), enabled: hasTab, run: () => saveActive(false) },
      { label: "Save As…", accel: "a", shortcut: chordHint("file.saveAs"), enabled: hasTab, run: () => saveActive(true) },
      { label: "Close", accel: "c", shortcut: chordHint("file.close"), enabled: hasTab, run: () => { const tab = activeTab(); if (tab) return closeTab(tab); } },
      { label: "Exit", accel: "x", shortcut: chordHint("file.exit"), enabled: true, run: () => exitApp() },
    ];
  }
  if (name === "Edit") {
    return [
      { label: "Undo", accel: "u", shortcut: "Ctrl+Z", enabled: hasTab, run: () => withEditor(runUndo) },
      { label: "Redo", accel: "r", shortcut: "Ctrl+Y", enabled: hasTab, run: () => withEditor(runRedo) },
      { label: "Cut", accel: "t", shortcut: "Ctrl+X", enabled: hasTab, run: () => withEditor((editor) => copySelection(editor, true)) },
      { label: "Copy", accel: "c", shortcut: "Ctrl+C", enabled: hasTab, run: () => withEditor((editor) => copySelection(editor, false)) },
      { label: "Paste", accel: "p", shortcut: "Ctrl+V", enabled: hasTab, run: () => withEditor(pasteClipboard) },
      { label: "Find", accel: "f", shortcut: chordHint("edit.find"), enabled: hasTab, run: () => withEditor(openFind) },
      { label: "Replace", accel: "e", shortcut: chordHint("edit.replace"), enabled: hasTab, run: () => withEditor(openReplace) },
      { label: "Select All", accel: "a", shortcut: "Ctrl+A", enabled: hasTab, run: () => withEditor(runSelectAll) },
    ];
  }
  if (name === "Selection") {
    return [
      { label: "Duplicate Line", accel: "d", shortcut: chordHint("edit.duplicateLine"), enabled: hasTab, run: () => withEditor(duplicateLines) },
      { label: "Move Line Up", accel: "u", shortcut: chordHint("edit.moveLineUp"), enabled: hasTab, run: () => withEditor((editor) => moveLines(editor, -1)) },
      { label: "Move Line Down", accel: "n", shortcut: chordHint("edit.moveLineDown"), enabled: hasTab, run: () => withEditor((editor) => moveLines(editor, 1)) },
    ];
  }
  if (name === "View") {
    return [
      { label: "Word Wrap", accel: "w", shortcut: chordHint("view.wordWrap"), enabled: true, checked: settings.wordWrap, run: toggleWrap },
      { label: "Line Numbers", accel: "l", enabled: true, checked: settings.lineNumbers, run: toggleNumbers },
      {
        label: "Highlight Current Line",
        accel: "h",
        enabled: true,
        checked: settings.highlightCurrentLine,
        run: toggleHighlightCurrentLine,
      },
      { label: "Show Tabs", accel: "t", enabled: true, checked: chrome.showTabs, run: toggleShowTabs },
      { label: "Show Status Bar", accel: "s", enabled: true, checked: chrome.showStatusBar, run: toggleShowStatusBar },
      { label: "Light Mode", accel: "m", enabled: true, checked: chrome.lightMode, run: toggleLightMode },
      { label: "Zen Mode", accel: "z", shortcut: chordHint("view.zen"), enabled: true, checked: zenMode, run: toggleZenMode },
      { label: "Zoom In", accel: "i", shortcut: chordHint("view.zoomIn"), enabled: true, run: () => zoom(1) },
      { label: "Zoom Out", accel: "o", shortcut: chordHint("view.zoomOut"), enabled: true, run: () => zoom(-1) },
      { label: "Reset Zoom", accel: "r", shortcut: chordHint("view.zoomReset"), enabled: true, run: () => zoom(0) },
    ];
  }
  if (name === "Settings") {
    return [
      {
        label: "Font",
        accel: "f",
        enabled: true,
        children: FONT_OPTIONS.map((option) => ({
          label: option.label,
          accel: option.accel,
          enabled: true,
          checked: settings.fontFamily === option.id,
          run: () => setFontFamily(option.id),
        })),
      },
      {
        label: "Caret Blink",
        accel: "b",
        enabled: true,
        checked: settings.caretBlink,
        run: toggleCaretBlink,
      },
      {
        label: "Caret Width",
        accel: "w",
        enabled: true,
        children: CARET_WIDTH_OPTIONS.map((width) => ({
          label: width === "block" ? "Block" : `${width} px`,
          accel: width === "block" ? "b" : String(width),
          enabled: true,
          checked: settings.caretWidth === width,
          run: () => setCaretWidth(width),
        })),
      },
      {
        label: "Tab Length",
        accel: "l",
        enabled: true,
        children: TAB_SIZE_OPTIONS.map((size) => ({
          label: String(size),
          accel: String(size),
          enabled: true,
          checked: settings.tabSize === size,
          run: () => setTabSize(size),
        })),
      },
      {
        label: "Insert Spaces",
        accel: "i",
        enabled: true,
        checked: settings.insertSpaces,
        run: toggleInsertSpaces,
      },
      {
        label: "Line Spacing",
        accel: "s",
        enabled: true,
        children: LINE_SPACING_OPTIONS.map((spacing) => ({
          label: String(spacing),
          accel: spacing === 1 ? "1" : spacing === 1.2 ? "2" : spacing === 1.5 ? "5" : spacing === 1.8 ? "8" : "0",
          enabled: true,
          checked: settings.lineSpacing === spacing,
          run: () => setLineSpacing(spacing),
        })),
      },
      {
        label: "Padding",
        accel: "p",
        enabled: true,
        children: EDITOR_PADDING_OPTIONS.map((padding) => ({
          label: `${padding} px`,
          accel: padding === 16 ? "1" : padding === 24 ? "2" : String(padding),
          enabled: true,
          checked: settings.editorPadding === padding,
          run: () => setEditorPadding(padding),
        })),
      },
      { label: "Vim", accel: "v", shortcut: chordHint("settings.vim"), enabled: true, checked: settings.vimMode, run: toggleVimMode },
      {
        label: "Keyboard Shortcuts",
        accel: "k",
        enabled: true,
        run: () => {
          void showShortcutEditor();
        },
      },
    ];
  }
  return [
    { label: "Keyboard Shortcuts", accel: "k", enabled: true, run: () => showShortcuts() },
    { label: "Check for Updates", accel: "u", enabled: true, run: () => { void checkForUpdates(); } },
    { label: "About", accel: "a", enabled: true, run: () => showAbout() },
  ];
}

const MENU_NAMES = ["File", "Edit", "Selection", "View", "Settings", "Help"];

function buildMenus(): void {
  for (const name of MENU_NAMES) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "menu-button";
    button.textContent = name;
    button.dataset.menu = name;
    button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-expanded", "false");
    button.addEventListener("click", () => {
      if (menuName === name) closeMenu();
      else openMenu(name);
    });
    menubar.append(button);
  }
}

function openMenu(name: string, focusIndex = 0): void {
  closeMenu();
  menuName = name;
  const button = menubar.querySelector<HTMLButtonElement>(`[data-menu="${name}"]`);
  if (!button) return;
  button.setAttribute("aria-expanded", "true");
  const menu = document.createElement("div");
  menu.className = "menu";
  menu.id = "app-menu";
  menu.setAttribute("role", "menu");
  const items = menuItems(name);
  items.forEach((item, index) => {
    if (index === items.length - 1 && name === "File") menu.append(separator());
    if (name === "Edit" && (item.label === "Cut" || item.label === "Find" || item.label === "Select All")) menu.append(separator());
    if (
      name === "View" &&
      (item.label === "Show Tabs" || item.label === "Zen Mode" || item.label === "Zoom In")
    ) {
      menu.append(separator());
    }
    if (
      name === "Settings" &&
      (item.label === "Caret Blink" ||
        item.label === "Tab Length" ||
        item.label === "Line Spacing" ||
        item.label === "Vim" ||
        item.label === "Keyboard Shortcuts")
    ) {
      menu.append(separator());
    }
    menu.append(menuButton(item));
  });
  document.body.append(menu);
  const rect = button.getBoundingClientRect();
  menu.style.left = `${rect.left}px`;
  menu.style.top = `${rect.bottom}px`;
  const entries = [...menu.querySelectorAll<HTMLButtonElement>("[data-item]")].filter((entry) => !entry.disabled);
  menuIndex = Math.max(0, Math.min(focusIndex, entries.length - 1));
  entries[menuIndex]?.focus();
}

function separator(): HTMLHRElement {
  const line = document.createElement("hr");
  return line;
}

function menuButton(item: MenuItem): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.item = "true";
  button.dataset.accel = item.accel.toLowerCase();
  button.disabled = !item.enabled;
  button.setAttribute("role", "menuitem");
  const check = document.createElement("span");
  check.className = `check${item.checked ? " on" : ""}`;
  button.append(check, underline(item.label, item.accel));
  if (item.shortcut) {
    const hint = document.createElement("span");
    hint.className = "hint";
    hint.textContent = item.shortcut;
    button.append(hint);
  } else if (item.children) {
    const hint = document.createElement("span");
    hint.className = "hint";
    hint.textContent = "›";
    button.append(hint);
  }
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!item.enabled) return;
    if (item.children) {
      openFlyout(button, item.children);
      return;
    }
    closeMenu();
    void item.run?.();
  });
  button.addEventListener("mouseenter", () => {
    if (item.children && item.enabled) openFlyout(button, item.children);
  });
  return button;
}

function underline(label: string, accel: string): HTMLSpanElement {
  const span = document.createElement("span");
  const index = accel ? label.toLowerCase().indexOf(accel.toLowerCase()) : -1;
  if (index < 0) {
    span.textContent = label;
    return span;
  }
  span.append(label.slice(0, index));
  const mark = document.createElement("u");
  mark.textContent = label.slice(index, index + 1);
  span.append(mark, label.slice(index + 1));
  return span;
}

function openFlyout(anchor: HTMLElement, items: MenuItem[]): void {
  document.querySelector("#app-flyout")?.remove();
  const flyout = document.createElement("div");
  flyout.className = "flyout";
  flyout.id = "app-flyout";
  flyout.setAttribute("role", "menu");
  for (const item of items) flyout.append(menuButton(item));
  document.body.append(flyout);
  const rect = anchor.getBoundingClientRect();
  flyout.style.left = `${rect.right - 4}px`;
  flyout.style.top = `${rect.top}px`;
}

function closeMenu(): void {
  menuName = null;
  document.querySelector("#app-menu")?.remove();
  document.querySelector("#app-flyout")?.remove();
  for (const button of menubar.querySelectorAll<HTMLButtonElement>(".menu-button")) {
    button.setAttribute("aria-expanded", "false");
  }
}

function menuEntries(): HTMLButtonElement[] {
  const flyout = document.querySelector("#app-flyout");
  const root = flyout ?? document.querySelector("#app-menu");
  if (!root) return [];
  return [...root.querySelectorAll<HTMLButtonElement>("[data-item]")].filter((entry) => !entry.disabled);
}

function moveMenu(delta: number): void {
  const entries = menuEntries();
  if (!entries.length) return;
  menuIndex = (menuIndex + delta + entries.length) % entries.length;
  entries[menuIndex]?.focus();
}

function cycleMenu(delta: number): void {
  if (!menuName) return;
  const index = MENU_NAMES.indexOf(menuName);
  const next = MENU_NAMES[(index + delta + MENU_NAMES.length) % MENU_NAMES.length] ?? "File";
  openMenu(next);
}

function renderShortcuts(target: HTMLElement, rows: { label: string; keys: string[] }[]): void {
  target.replaceChildren();
  for (const row of rows) {
    const label = document.createElement("span");
    label.className = "shortcut-label";
    label.textContent = row.label;
    const keys = document.createElement("span");
    keys.className = "keys";
    row.keys.forEach((key, index) => {
      if (index > 0) {
        const plus = document.createElement("span");
        plus.className = "plus";
        plus.textContent = "+";
        keys.append(plus);
      }
      const pill = document.createElement("span");
      pill.className = "key";
      pill.textContent = key;
      keys.append(pill);
    });
    target.append(label, keys);
  }
}

function openDialog(title: string, body: HTMLElement, buttons: DialogButton[]): Promise<string> {
  return new Promise((resolve) => {
    const dialog = document.createElement("div");
    dialog.className = "dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    const heading = document.createElement("h2");
    heading.textContent = title;
    const actions = document.createElement("div");
    actions.className = "dialog-actions";
    let settled = false;
    const finish = (value: string) => {
      if (settled) return;
      settled = true;
      modal.replaceChildren();
      resolve(value);
      view?.focus();
    };
    dialog.append(heading, body, actions);
    for (const spec of buttons) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = spec.label;
      button.addEventListener("click", () => finish(spec.value));
      actions.append(button);
    }
    modal.replaceChildren(dialog);
    const controls = [...actions.querySelectorAll("button")];
    controls[0]?.focus();
    dialog.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finish(buttons[buttons.length - 1]?.value ?? "cancel");
      }
      if (event.key !== "Tab") return;
      const list = controls;
      const current = list.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.shiftKey ? (current <= 0 ? list.length - 1 : current - 1) : (current + 1) % list.length;
      event.preventDefault();
      list[next]?.focus();
    });
  });
}

function showError(message: string): Promise<string> {
  const body = document.createElement("p");
  body.textContent = message;
  return openDialog("Text Editor", body, [{ label: "Close", value: "close" }]);
}

function confirmSave(name: string): Promise<"save" | "discard" | "cancel"> {
  const body = document.createElement("p");
  body.textContent = `Save changes to ${name}?`;
  return openDialog(`Save changes to ${name}?`, body, [
    { label: "Save", value: "save" },
    { label: "Don't Save", value: "discard" },
    { label: "Cancel", value: "cancel" },
  ]) as Promise<"save" | "discard" | "cancel">;
}

function showAbout(): Promise<string> {
  const body = document.createElement("p");
  body.textContent = "Version 0.1.12. A small text editor.";
  return openDialog("Text Editor", body, [{ label: "Close", value: "close" }]);
}

async function checkForUpdates(): Promise<void> {
  if (!inTauri()) {
    await showError("Updates are only available in the desktop app.");
    return;
  }
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) {
      const ok = document.createElement("p");
      ok.textContent = "You're up to date.";
      await openDialog("Updates", ok, [{ label: "Close", value: "close" }]);
      return;
    }
    const body = document.createElement("p");
    body.textContent = `Version ${update.version} is available. Install and restart?`;
    const choice = await openDialog("Update", body, [
      { label: "Install", value: "install" },
      { label: "Cancel", value: "cancel" },
    ]);
    if (choice !== "install") return;
    await update.downloadAndInstall();
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  } catch (error) {
    await showError(errorText(error));
  }
}

function showShortcuts(): Promise<string> {
  const body = document.createElement("div");
  body.className = "shortcut-list";
  renderShortcuts(body, helpShortcutRows());
  return openDialog("Keyboard Shortcuts", body, [{ label: "Close", value: "close" }]);
}

function runCommand(id: CommandId): void {
  switch (id) {
    case "file.new":
      newFile();
      return;
    case "file.open":
      void openFile();
      return;
    case "file.recent":
      void openMostRecent();
      return;
    case "file.save":
      void saveActive(false);
      return;
    case "file.saveAs":
      void saveActive(true);
      return;
    case "file.close": {
      const tab = activeTab();
      if (tab) void closeTab(tab);
      return;
    }
    case "file.exit":
      void exitApp();
      return;
    case "edit.find":
      if (activeTab()) withEditor(openFind);
      return;
    case "edit.replace":
      if (activeTab()) withEditor(openReplace);
      return;
    case "edit.duplicateLine":
      withEditor(duplicateLines);
      return;
    case "edit.moveLineUp":
      withEditor((editor) => moveLines(editor, -1));
      return;
    case "edit.moveLineDown":
      withEditor((editor) => moveLines(editor, 1));
      return;
    case "view.wordWrap":
      toggleWrap();
      return;
    case "view.zen":
      toggleZenMode();
      return;
    case "view.zoomIn":
      zoom(1);
      return;
    case "view.zoomOut":
      zoom(-1);
      return;
    case "view.zoomReset":
      zoom(0);
      return;
    case "view.nextTab":
      cycleTab(1);
      return;
    case "view.prevTab":
      cycleTab(-1);
      return;
    case "settings.vim":
      void toggleVimMode();
      return;
  }
}

function showShortcutEditor(): Promise<string> {
  const body = document.createElement("div");
  body.className = "shortcut-editor";
  const list = document.createElement("div");
  list.className = "shortcut-editor-list";
  body.append(list);

  const paint = (): void => {
    const conflicts = conflictingCommands(bindings);
    list.replaceChildren();
    let focusBind: HTMLButtonElement | null = null;
    for (const command of COMMAND_DEFS) {
      const row = document.createElement("div");
      row.className = `shortcut-row${conflicts.has(command.id) ? " conflict" : ""}`;
      const label = document.createElement("span");
      label.className = "shortcut-label";
      label.textContent = command.label;
      const bind = document.createElement("button");
      bind.type = "button";
      bind.className = `shortcut-bind${recordingCommand === command.id ? " recording" : ""}`;
      const chord = bindings[command.id];
      bind.textContent =
        recordingCommand === command.id ? "Press keys…" : chord ? formatChord(chord) : "None";
      bind.addEventListener("click", () => {
        recordingCommand = command.id;
        paint();
      });
      if (recordingCommand === command.id) focusBind = bind;
      row.append(label, bind);
      list.append(row);
    }
    focusBind?.focus();
  };

  paintShortcutEditor = paint;
  paint();

  return new Promise((resolve) => {
    const dialog = document.createElement("div");
    dialog.className = "dialog shortcut-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    const heading = document.createElement("h2");
    heading.textContent = "Keyboard Shortcuts";
    const actions = document.createElement("div");
    actions.className = "dialog-actions";
    let settled = false;
    const finish = (value: string) => {
      if (settled) return;
      settled = true;
      recordingCommand = null;
      paintShortcutEditor = null;
      modal.replaceChildren();
      refreshEmptyShortcuts();
      resolve(value);
      view?.focus();
    };

    const reset = document.createElement("button");
    reset.type = "button";
    reset.textContent = "Reset";
    reset.addEventListener("click", () => {
      recordingCommand = null;
      saveBindings(resolveBindings({}));
      paint();
      refreshEmptyShortcuts();
    });

    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "Close";
    close.addEventListener("click", () => finish("close"));

    actions.append(reset, close);
    dialog.append(heading, body, actions);
    modal.replaceChildren(dialog);
    close.focus();

    dialog.addEventListener("keydown", (event) => {
      if (recordingCommand) return;
      if (event.key === "Escape") {
        event.preventDefault();
        finish("close");
      }
    });
  });
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key === "Alt" && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
    altAlone = true;
  } else if (event.altKey) {
    altAlone = false;
  }

  // Capture rebinds even when the shortcuts dialog holds focus.
  if (recordingCommand) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      recordingCommand = null;
      paintShortcutEditor?.();
      return;
    }
    if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault();
      event.stopPropagation();
      const id = recordingCommand;
      recordingCommand = null;
      saveBindings({ ...bindings, [id]: null });
      paintShortcutEditor?.();
      refreshEmptyShortcuts();
      return;
    }
    const chord = chordFromEvent(event);
    if (!chord) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const id = recordingCommand;
    recordingCommand = null;
    saveBindings({ ...bindings, [id]: chord });
    paintShortcutEditor?.();
    refreshEmptyShortcuts();
    return;
  }

  if (modal.childElementCount > 0) return;

  if (menuName) {
    const entries = menuEntries();
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu();
      view?.focus();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveMenu(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveMenu(-1);
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      const current = entries[menuIndex];
      current?.click();
      if (!document.querySelector("#app-flyout")) cycleMenu(1);
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (document.querySelector("#app-flyout")) document.querySelector("#app-flyout")?.remove();
      else cycleMenu(-1);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      entries[menuIndex]?.click();
      return;
    }
    if (/^[a-z]$/i.test(event.key) && !event.ctrlKey && !event.metaKey) {
      const match = entries.find((entry) => entry.dataset.accel === event.key.toLowerCase());
      if (match) {
        event.preventDefault();
        match.click();
      }
    }
    return;
  }

  if (event.defaultPrevented) return;

  const chord = chordFromEvent(event);
  if (!chord) return;

  const command = bindingLookup.get(chord);
  if (command) {
    event.preventDefault();
    event.stopPropagation();
    runCommand(command);
    return;
  }

  // Stop CodeMirror / browser from keeping a rebound-away default.
  if (isAbandonedDefault(chord, bindings)) {
    event.preventDefault();
    event.stopPropagation();
  }
}

function onKeyUp(event: KeyboardEvent): void {
  if (event.key === "Alt" && altAlone && !zenMode && !menuName && modal.childElementCount === 0) {
    event.preventDefault();
    openMenu("File");
  }
  altAlone = false;
}

async function refreshMaximize(): Promise<void> {
  if (!inTauri()) return;
  const maximized = await getCurrentWindow().isMaximized();
  maxButton.setAttribute("aria-label", maximized ? "Restore" : "Maximize");
  maxButton.innerHTML = maximized
    ? '<svg viewBox="0 0 10 10" aria-hidden="true"><rect x="2.5" y="1" width="6" height="6" fill="none" stroke="currentColor"/><rect x="1" y="3" width="6" height="6" fill="#181818" stroke="currentColor"/></svg>'
    : '<svg viewBox="0 0 10 10" aria-hidden="true"><rect x="1.5" y="1.5" width="7" height="7" fill="none" stroke="currentColor"/></svg>';
}

function bindWindowControls(): void {
  document.querySelector("#win-min")?.addEventListener("click", () => {
    if (inTauri()) void getCurrentWindow().minimize();
  });
  maxButton.addEventListener("click", () => {
    if (!inTauri()) return;
    void getCurrentWindow().toggleMaximize().then(() => refreshMaximize());
  });
  document.querySelector("#win-close")?.addEventListener("click", () => {
    if (inTauri()) void getCurrentWindow().close();
    else void exitApp();
  });
  const startWindowDrag = (event: Event): void => {
    if (!inTauri() || (event as MouseEvent).button !== 0) return;
    event.preventDefault();
    void getCurrentWindow().startDragging();
  };
  // Mark + Zen edges: data-tauri-drag-region can miss SVG/empty hits in WebView2.
  document.querySelector("#brand-drag")?.addEventListener("mousedown", startWindowDrag);
  document.querySelector(".mark-drag")?.addEventListener("mousedown", startWindowDrag);
  for (const edge of zenDragEl.querySelectorAll(".zen-edge")) {
    edge.addEventListener("mousedown", (event) => {
      if (!zenMode) return;
      startWindowDrag(event);
    });
  }
  // Capture so Ctrl+Shift+Z wins over CodeMirror's Linux redo binding.
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("keyup", onKeyUp);
  document.addEventListener("mousedown", (event) => {
    const target = event.target as Node;
    if (menuName && !menubar.contains(target) && !document.querySelector("#app-menu")?.contains(target) && !document.querySelector("#app-flyout")?.contains(target)) {
      closeMenu();
    }
  });
}

async function boot(): Promise<void> {
  applyAppTheme();
  refreshEmptyShortcuts();
  buildMenus();
  bindWindowControls();
  renderChrome();

  if (inTauri()) {
    const win = getCurrentWindow();
    await win.onCloseRequested(async (event) => {
      if (closing) return;
      event.preventDefault();
      await exitApp();
    });
    await win.onResized(() => {
      void refreshMaximize();
    });
    try {
      await getCurrentWebview().onDragDropEvent((event) => {
        if (event.payload.type === "drop") {
          for (const path of event.payload.paths) void openPath(path);
        }
      });
    } catch {
      // Opening from the menu still works when drag-and-drop is unavailable.
    }
    void refreshMaximize();
    // Show before boot IPC / startup files so the window is not held invisible.
    await win.show();
  }

  const [ending, recentPaths, files] = await Promise.all([
    defaultLineEnding().catch((): LineEnding => "lf"),
    loadRecent().catch((): string[] => []),
    startupFiles().catch((): string[] => []),
    settings.vimMode ? prepareVim() : Promise.resolve(),
  ]);
  defaultEnding = ending;
  recent = recentPaths;
  renderChrome();

  for (const path of files) await openPath(path);
}

void boot();
