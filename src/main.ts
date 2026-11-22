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
  runRedo,
  runSelectAll,
  runUndo,
  type EditorSettings,
} from "./editor.ts";
import {
  fileName,
  isDirty,
  nextTabIndex,
  nextUntitled,
  readChromeSettings,
  readEditorSettings,
  CARET_WIDTH_OPTIONS,
  TAB_SIZE_OPTIONS,
  windowTitle,
  writeChromeSettings,
  writeEditorSettings,
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

const SHORTCUTS: { label: string; keys: string[] }[] = [
  { label: "New File", keys: ["Ctrl", "N"] },
  { label: "Open File", keys: ["Ctrl", "O"] },
  { label: "Save", keys: ["Ctrl", "S"] },
  { label: "Find", keys: ["Ctrl", "F"] },
  { label: "Close File", keys: ["Ctrl", "W"] },
  { label: "Open Recent", keys: ["Ctrl", "R"] },
];

const HELP_SHORTCUTS: { label: string; keys: string[] }[] = [
  ...SHORTCUTS,
  { label: "Save As", keys: ["Ctrl", "Shift", "S"] },
  { label: "Exit", keys: ["Ctrl", "Shift", "W"] },
  { label: "Replace", keys: ["Ctrl", "H"] },
  { label: "Undo", keys: ["Ctrl", "Z"] },
  { label: "Redo", keys: ["Ctrl", "Y"] },
  { label: "Duplicate Line", keys: ["Ctrl", "Shift", "D"] },
  { label: "Move Line Up", keys: ["Alt", "Up"] },
  { label: "Move Line Down", keys: ["Alt", "Down"] },
  { label: "Word Wrap", keys: ["Alt", "Z"] },
  { label: "Zen Mode", keys: ["Ctrl", "Shift", "Z"] },
  { label: "Zoom In", keys: ["Ctrl", "+"] },
  { label: "Zoom Out", keys: ["Ctrl", "−"] },
  { label: "Reset Zoom", keys: ["Ctrl", "0"] },
  { label: "Next Tab", keys: ["Ctrl", "Tab"] },
  { label: "Previous Tab", keys: ["Ctrl", "Shift", "Tab"] },
];

const titlebarEl = document.querySelector("#titlebar") as HTMLElement;
const tabsEl = document.querySelector("#tabs") as HTMLElement;
const emptyEl = document.querySelector("#empty") as HTMLElement;
const editorEl = document.querySelector("#editor") as HTMLElement;
const statusEl = document.querySelector("#status") as HTMLElement;
const statusPath = document.querySelector("#status-path") as HTMLElement;
const statusPos = document.querySelector("#status-pos") as HTMLElement;
const statusEnding = document.querySelector("#status-ending") as HTMLElement;
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
    doc: EditorStatePlaceholder(text),
    dirty: false,
  };
  tab.doc = createDocument(text, settings, onEditorUpdate, chrome.lightMode);
  return tab;
}

function EditorStatePlaceholder(text: string): EditorState {
  return createDocument(text, settings, onEditorUpdate, chrome.lightMode);
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
}

function paintStatus(tab: Tab): void {
  const position = caretPosition(tab.doc);
  statusPath.textContent = tab.path ?? "Untitled";
  statusPos.textContent = `Ln ${position.line}, Col ${position.column}`;
  statusEnding.textContent = tab.lineEnding === "crlf" ? "CRLF" : "LF";
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
    tab.path = path;
    tab.name = fileName(path);
    tab.savedText = text;
    tab.dirty = false;
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

  Vim.defineEx("write", "w", write);
  Vim.defineEx("quit", "q", (_cm, params) => quit(params));
  Vim.defineEx("wq", "wq", writeQuit);
  Vim.defineEx("xit", "x", writeQuit);
  Vim.defineEx("exit", "exi", writeQuit);
  Vim.defineEx("qall", "qa", (_cm, params) => quitAll(params));
  Vim.defineEx("quitall", "quita", (_cm, params) => quitAll(params));
  Vim.defineEx("wqall", "wqa", writeQuitAll);
  Vim.defineEx("xall", "xa", writeQuitAll);
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
      { label: "New", accel: "n", shortcut: "Ctrl+N", enabled: true, run: newFile },
      { label: "Open…", accel: "o", shortcut: "Ctrl+O", enabled: true, run: () => openFile() },
      { label: "Open Recent", accel: "r", shortcut: "Ctrl+R", enabled: recent.length > 0, children: recentItems },
      { label: "Save", accel: "s", shortcut: "Ctrl+S", enabled: hasTab, run: () => saveActive(false) },
      { label: "Save As…", accel: "a", shortcut: "Ctrl+Shift+S", enabled: hasTab, run: () => saveActive(true) },
      { label: "Close", accel: "c", shortcut: "Ctrl+W", enabled: hasTab, run: () => { const tab = activeTab(); if (tab) return closeTab(tab); } },
      { label: "Exit", accel: "x", shortcut: "Ctrl+Shift+W", enabled: true, run: () => exitApp() },
    ];
  }
  if (name === "Edit") {
    return [
      { label: "Undo", accel: "u", shortcut: "Ctrl+Z", enabled: hasTab, run: () => withEditor(runUndo) },
      { label: "Redo", accel: "r", shortcut: "Ctrl+Y", enabled: hasTab, run: () => withEditor(runRedo) },
      { label: "Cut", accel: "t", shortcut: "Ctrl+X", enabled: hasTab, run: () => withEditor((editor) => copySelection(editor, true)) },
      { label: "Copy", accel: "c", shortcut: "Ctrl+C", enabled: hasTab, run: () => withEditor((editor) => copySelection(editor, false)) },
      { label: "Paste", accel: "p", shortcut: "Ctrl+V", enabled: hasTab, run: () => withEditor(pasteClipboard) },
      { label: "Find", accel: "f", shortcut: "Ctrl+F", enabled: hasTab, run: () => withEditor(openFind) },
      { label: "Replace", accel: "e", shortcut: "Ctrl+H", enabled: hasTab, run: () => withEditor(openReplace) },
      { label: "Select All", accel: "a", shortcut: "Ctrl+A", enabled: hasTab, run: () => withEditor(runSelectAll) },
    ];
  }
  if (name === "Selection") {
    return [
      { label: "Duplicate Line", accel: "d", shortcut: "Ctrl+Shift+D", enabled: hasTab, run: () => withEditor(duplicateLines) },
      { label: "Move Line Up", accel: "u", shortcut: "Alt+Up", enabled: hasTab, run: () => withEditor((editor) => moveLines(editor, -1)) },
      { label: "Move Line Down", accel: "n", shortcut: "Alt+Down", enabled: hasTab, run: () => withEditor((editor) => moveLines(editor, 1)) },
    ];
  }
  if (name === "View") {
    return [
      { label: "Word Wrap", accel: "w", shortcut: "Alt+Z", enabled: true, checked: settings.wordWrap, run: toggleWrap },
      { label: "Line Numbers", accel: "l", enabled: true, checked: settings.lineNumbers, run: toggleNumbers },
      {
        label: "Highlight Current Line",
        accel: "h",
        enabled: true,
        checked: settings.highlightCurrentLine,
        run: toggleHighlightCurrentLine,
      },
      { label: "Zen Mode", accel: "z", shortcut: "Ctrl+Shift+Z", enabled: true, checked: zenMode, run: toggleZenMode },
      { label: "Zoom In", accel: "i", shortcut: "Ctrl++", enabled: true, run: () => zoom(1) },
      { label: "Zoom Out", accel: "o", shortcut: "Ctrl+-", enabled: true, run: () => zoom(-1) },
      { label: "Reset Zoom", accel: "r", shortcut: "Ctrl+0", enabled: true, run: () => zoom(0) },
    ];
  }
  if (name === "Settings") {
    return [
      { label: "Show Tabs", accel: "t", enabled: true, checked: chrome.showTabs, run: toggleShowTabs },
      { label: "Show Status Bar", accel: "s", enabled: true, checked: chrome.showStatusBar, run: toggleShowStatusBar },
      { label: "Light Mode", accel: "m", enabled: true, checked: chrome.lightMode, run: toggleLightMode },
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
      { label: "Vim", accel: "v", shortcut: "Ctrl+Shift+V", enabled: true, checked: settings.vimMode, run: toggleVimMode },
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
    ];
  }
  return [
    { label: "Keyboard Shortcuts", accel: "k", enabled: true, run: () => showShortcuts() },
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
    if (name === "View" && (item.label === "Zen Mode" || item.label === "Zoom In")) menu.append(separator());
    if (
      name === "Settings" &&
      (item.label === "Caret Blink" || item.label === "Vim" || item.label === "Tab Length")
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
  body.textContent = "Version 0.1.11. A small text editor.";
  return openDialog("Text Editor", body, [{ label: "Close", value: "close" }]);
}

function showShortcuts(): Promise<string> {
  const body = document.createElement("div");
  body.className = "shortcut-list";
  renderShortcuts(body, HELP_SHORTCUTS);
  return openDialog("Keyboard Shortcuts", body, [{ label: "Close", value: "close" }]);
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key === "Alt" && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
    altAlone = true;
  } else if (event.altKey) {
    altAlone = false;
  }

  if (modal.childElementCount > 0) return;

  const modKey = event.ctrlKey || event.metaKey;
  if (modKey && event.shiftKey && !event.altKey && event.key.toLowerCase() === "z") {
    event.preventDefault();
    event.stopPropagation();
    toggleZenMode();
    return;
  }

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
  const key = event.key.toLowerCase();
  const mod = event.ctrlKey || event.metaKey;

  if (mod && !event.altKey && key === "n") {
    event.preventDefault();
    newFile();
  } else if (mod && !event.altKey && key === "o") {
    event.preventDefault();
    void openFile();
  } else if (mod && !event.shiftKey && !event.altKey && key === "r") {
    event.preventDefault();
    void openMostRecent();
  } else if (mod && event.shiftKey && key === "s") {
    event.preventDefault();
    void saveActive(true);
  } else if (mod && !event.shiftKey && key === "s") {
    event.preventDefault();
    void saveActive(false);
  } else if (mod && event.shiftKey && !event.altKey && key === "w") {
    event.preventDefault();
    void exitApp();
  } else if (mod && event.shiftKey && !event.altKey && key === "v") {
    event.preventDefault();
    void toggleVimMode();
  } else if (mod && !event.shiftKey && !event.altKey && key === "w") {
    event.preventDefault();
    const tab = activeTab();
    if (tab) void closeTab(tab);
  } else if (mod && !event.altKey && event.key === "Tab") {
    event.preventDefault();
    cycleTab(event.shiftKey ? -1 : 1);
  } else if (mod && !event.altKey && (event.key === "=" || event.key === "+")) {
    event.preventDefault();
    zoom(1);
  } else if (mod && !event.altKey && (event.key === "-" || event.key === "_")) {
    event.preventDefault();
    zoom(-1);
  } else if (mod && !event.shiftKey && !event.altKey && event.key === "0") {
    event.preventDefault();
    zoom(0);
  } else if (event.altKey && !mod && key === "z") {
    event.preventDefault();
    toggleWrap();
  } else if (!view?.hasFocus && mod && !event.altKey && key === "f" && activeTab()) {
    event.preventDefault();
    withEditor(openFind);
  } else if (!view?.hasFocus && mod && !event.altKey && key === "h" && activeTab()) {
    event.preventDefault();
    withEditor(openReplace);
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
  renderShortcuts(document.querySelector("#shortcuts") as HTMLElement, SHORTCUTS);
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
