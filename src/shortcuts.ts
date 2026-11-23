/** App commands that can be rebound in Settings. */

export const COMMAND_DEFS = [
  { id: "file.new", label: "New File", defaultChord: "Ctrl+N" },
  { id: "file.open", label: "Open File", defaultChord: "Ctrl+O" },
  { id: "file.recent", label: "Open Recent", defaultChord: "Ctrl+R" },
  { id: "file.save", label: "Save", defaultChord: "Ctrl+S" },
  { id: "file.saveAs", label: "Save As", defaultChord: "Ctrl+Shift+S" },
  { id: "file.close", label: "Close File", defaultChord: "Ctrl+W" },
  { id: "file.exit", label: "Exit", defaultChord: "Ctrl+Shift+W" },
  { id: "edit.find", label: "Find", defaultChord: "Ctrl+F" },
  { id: "edit.replace", label: "Replace", defaultChord: "Ctrl+H" },
  { id: "edit.duplicateLine", label: "Duplicate Line", defaultChord: "Ctrl+Shift+D" },
  { id: "edit.moveLineUp", label: "Move Line Up", defaultChord: "Alt+ArrowUp" },
  { id: "edit.moveLineDown", label: "Move Line Down", defaultChord: "Alt+ArrowDown" },
  { id: "view.wordWrap", label: "Word Wrap", defaultChord: "Alt+Z" },
  { id: "view.zen", label: "Zen Mode", defaultChord: "Ctrl+Shift+Z" },
  { id: "view.zoomIn", label: "Zoom In", defaultChord: "Ctrl++" },
  { id: "view.zoomOut", label: "Zoom Out", defaultChord: "Ctrl+-" },
  { id: "view.zoomReset", label: "Reset Zoom", defaultChord: "Ctrl+0" },
  { id: "view.nextTab", label: "Next Tab", defaultChord: "Ctrl+Tab" },
  { id: "view.prevTab", label: "Previous Tab", defaultChord: "Ctrl+Shift+Tab" },
  { id: "settings.vim", label: "Vim", defaultChord: "Ctrl+Shift+V" },
] as const;

export type CommandId = (typeof COMMAND_DEFS)[number]["id"];

/** Chord string or null when unbound. */
export type ShortcutBindings = Record<CommandId, string | null>;

/** Overrides only; missing keys keep defaults. `null` clears a binding. */
export type ShortcutOverrides = Partial<Record<CommandId, string | null>>;

const COMMAND_IDS = new Set<string>(COMMAND_DEFS.map((command) => command.id));

export const DEFAULT_BINDINGS: ShortcutBindings = Object.fromEntries(
  COMMAND_DEFS.map((command) => [command.id, command.defaultChord]),
) as ShortcutBindings;

/** Commands shown on the empty-state shortcut strip. */
export const EMPTY_SCREEN_COMMANDS: CommandId[] = [
  "file.new",
  "file.open",
  "file.save",
  "edit.find",
  "file.close",
  "file.recent",
];

/** Map a keydown event to a canonical chord, or null if not a bindable chord. */
export function chordFromEvent(event: KeyboardEvent): string | null {
  const key = event.key;
  if (key === "Control" || key === "Shift" || key === "Alt" || key === "Meta") return null;

  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");

  const token = keyToken(event);
  if (!token) return null;
  // Bare printable keys without modifiers are not app shortcuts.
  if (parts.length === 0 && token.length === 1 && !/^F\d{1,2}$/.test(token)) return null;

  parts.push(token);
  return parts.join("+");
}

function keyToken(event: KeyboardEvent): string | null {
  const key = event.key;
  if (key === " ") return "Space";
  if (key === "ArrowUp" || key === "ArrowDown" || key === "ArrowLeft" || key === "ArrowRight") return key;
  if (key === "Tab") return "Tab";
  if (key === "Escape") return "Escape";
  if (key === "Enter") return "Enter";
  if (key === "Backspace") return "Backspace";
  if (key === "Delete") return "Delete";
  if (key === "Home" || key === "End" || key === "PageUp" || key === "PageDown") return key;
  if (key === "+" || key === "=") return "+";
  if (key === "-" || key === "_") return "-";
  if (/^F\d{1,2}$/.test(key)) return key;
  if (key.length === 1) return key.toUpperCase();
  // Digits / punctuation via event.code when Shift changes key text.
  if (event.code.startsWith("Digit")) return event.code.slice(5);
  if (event.code.startsWith("Key") && event.code.length === 4) return event.code.slice(3);
  return key.length <= 16 ? key : null;
}

/** Split a chord into display segments (e.g. Ctrl+Shift+S → ["Ctrl","Shift","S"]). */
export function chordParts(chord: string): string[] {
  if (chord === "Ctrl++") return ["Ctrl", "+"];
  if (chord.endsWith("++")) {
    const head = chord.slice(0, -1);
    return [...head.split("+").filter(Boolean), "+"];
  }
  return chord.split("+").filter(Boolean);
}

/** Human label for menus / help (en dash for minus; short arrow names). */
export function formatChord(chord: string | null): string {
  if (!chord) return "";
  return chordParts(chord)
    .map((part) => {
      if (part === "-") return "−";
      if (part === "ArrowUp") return "Up";
      if (part === "ArrowDown") return "Down";
      if (part === "ArrowLeft") return "Left";
      if (part === "ArrowRight") return "Right";
      return part;
    })
    .join("+");
}

/** Pill segments for the empty-state / help lists. */
export function displayParts(chord: string | null): string[] {
  if (!chord) return [];
  return formatChord(chord).split("+");
}

export function isCommandId(value: string): value is CommandId {
  return COMMAND_IDS.has(value);
}

export function normalizeOverrides(raw: unknown): ShortcutOverrides {
  if (!raw || typeof raw !== "object") return {};
  const out: ShortcutOverrides = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isCommandId(key)) continue;
    if (value === null) {
      out[key] = null;
      continue;
    }
    if (typeof value !== "string") continue;
    const chord = normalizeChordString(value);
    if (chord) out[key] = chord;
  }
  return out;
}

/** Accept stored / pasted chord strings into canonical form. */
export function normalizeChordString(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const rawParts = trimmed === "Ctrl++" || trimmed.endsWith("++")
    ? trimmed === "Ctrl++"
      ? ["Ctrl", "+"]
      : [...trimmed.slice(0, -1).split("+").filter(Boolean), "+"]
    : trimmed.split("+").map((part) => part.trim()).filter(Boolean);

  let ctrl = false;
  let alt = false;
  let shift = false;
  let key: string | null = null;
  for (const part of rawParts) {
    const lower = part.toLowerCase();
    if (lower === "ctrl" || lower === "control" || lower === "cmd" || lower === "meta" || lower === "mod") {
      ctrl = true;
      continue;
    }
    if (lower === "alt" || lower === "option") {
      alt = true;
      continue;
    }
    if (lower === "shift") {
      shift = true;
      continue;
    }
    if (part === "−" || part === "-") {
      key = "-";
      continue;
    }
    if (part === "+" || part === "=") {
      key = "+";
      continue;
    }
    if (/^arrow(up|down|left|right)$/i.test(part)) {
      key = `Arrow${part.slice(5, 6).toUpperCase()}${part.slice(6).toLowerCase()}`;
      continue;
    }
    key = part.length === 1 ? part.toUpperCase() : part;
  }
  if (!key) return null;
  const mods: string[] = [];
  if (ctrl) mods.push("Ctrl");
  if (alt) mods.push("Alt");
  if (shift) mods.push("Shift");
  if (mods.length === 0 && key.length === 1 && !/^F\d{1,2}$/.test(key)) return null;
  return [...mods, key].join("+");
}

export function resolveBindings(overrides: ShortcutOverrides = {}): ShortcutBindings {
  const bindings = { ...DEFAULT_BINDINGS };
  for (const command of COMMAND_DEFS) {
    if (Object.prototype.hasOwnProperty.call(overrides, command.id)) {
      const value = overrides[command.id];
      bindings[command.id] = value === undefined ? command.defaultChord : value;
    }
  }
  return bindings;
}

/** Commands that share a chord with at least one other command. */
export function conflictingCommands(bindings: ShortcutBindings): Set<CommandId> {
  const byChord = new Map<string, CommandId[]>();
  for (const command of COMMAND_DEFS) {
    const chord = bindings[command.id];
    if (!chord) continue;
    const list = byChord.get(chord) ?? [];
    list.push(command.id);
    byChord.set(chord, list);
  }
  const conflicts = new Set<CommandId>();
  for (const ids of byChord.values()) {
    if (ids.length < 2) continue;
    for (const id of ids) conflicts.add(id);
  }
  return conflicts;
}

/** chord → command. When conflicts exist, the first COMMAND_DEFS entry wins. */
export function chordLookup(bindings: ShortcutBindings): Map<string, CommandId> {
  const map = new Map<string, CommandId>();
  for (const command of COMMAND_DEFS) {
    const chord = bindings[command.id];
    if (!chord || map.has(chord)) continue;
    map.set(chord, command.id);
  }
  return map;
}

/** True when `chord` is some command's default but no longer bound to that command. */
export function isAbandonedDefault(chord: string, bindings: ShortcutBindings): boolean {
  for (const command of COMMAND_DEFS) {
    if (command.defaultChord === chord && bindings[command.id] !== chord) return true;
  }
  return false;
}

export function overridesFromBindings(bindings: ShortcutBindings): ShortcutOverrides {
  const overrides: ShortcutOverrides = {};
  for (const command of COMMAND_DEFS) {
    const current = bindings[command.id];
    if (current === command.defaultChord) continue;
    overrides[command.id] = current;
  }
  return overrides;
}

export function readShortcutOverrides(storage: Storage): ShortcutOverrides {
  try {
    const packed = storage.getItem("text-editor-shortcuts");
    if (!packed) return {};
    return normalizeOverrides(JSON.parse(packed));
  } catch {
    return {};
  }
}

export function writeShortcutOverrides(storage: Storage, overrides: ShortcutOverrides): void {
  const clean = normalizeOverrides(overrides);
  if (Object.keys(clean).length === 0) {
    storage.removeItem("text-editor-shortcuts");
    return;
  }
  storage.setItem("text-editor-shortcuts", JSON.stringify(clean));
}

export function labelFor(id: CommandId): string {
  return COMMAND_DEFS.find((command) => command.id === id)?.label ?? id;
}
