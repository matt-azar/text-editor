import { defaultKeymap, history, historyKeymap, indentWithTab, redo, selectAll, undo } from "@codemirror/commands";
import { bracketMatching, indentUnit } from "@codemirror/language";
import { highlightSelectionMatches, openSearchPanel, search, searchKeymap } from "@codemirror/search";
import { Compartment, EditorSelection, EditorState, type Extension } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { normalizeTabSize, type StoredEditorSettings } from "./state.ts";

export type EditorSettings = StoredEditorSettings;

const fontComp = new Compartment();
const wrapComp = new Compartment();
const gutterComp = new Compartment();
const indentComp = new Compartment();
const activeLineComp = new Compartment();

const chrome = EditorView.theme(
  {
    "&": {
      height: "100%",
      backgroundColor: "#181818",
      color: "#c8c8c8",
    },
    ".cm-scroller": {
      fontFamily: '"Cascadia Code", "Cascadia Mono", Consolas, monospace',
      lineHeight: "1.5",
    },
    ".cm-content": {
      caretColor: "#aeafad",
      padding: "8px 0",
      userSelect: "text",
      "-webkit-user-select": "text",
    },
    ".cm-line": {
      userSelect: "text",
      "-webkit-user-select": "text",
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: "#aeafad",
    },
    // Selection is drawn in a layer behind line backgrounds; keep this strong
    // and keep active-line paint translucent so same-line ranges stay visible.
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground":
      {
        backgroundColor: "#264f78 !important",
      },
    ".cm-selectionLayer .cm-selectionBackground": {
      backgroundColor: "#264f78 !important",
    },
    ".cm-gutters": {
      backgroundColor: "#181818",
      color: "#6e6e6e",
      border: "none",
    },
    ".cm-activeLine, .cm-activeLineGutter": {
      backgroundColor: "rgba(255, 255, 255, 0.045)",
    },
  },
  { dark: true },
);

function fontTheme(px: number): Extension {
  return EditorView.theme({
    "&": { fontSize: `${px}px` },
  });
}

function indentExtensions(tabSize: number): Extension[] {
  const size = normalizeTabSize(tabSize);
  return [EditorState.tabSize.of(size), indentUnit.of(" ".repeat(size))];
}

function activeLineExtensions(enabled: boolean): Extension[] {
  return enabled ? [highlightActiveLine(), highlightActiveLineGutter()] : [];
}

function settingEffects(settings: EditorSettings) {
  return [
    fontComp.reconfigure(fontTheme(settings.fontSize)),
    wrapComp.reconfigure(settings.wordWrap ? EditorView.lineWrapping : []),
    gutterComp.reconfigure(settings.lineNumbers ? lineNumbers() : []),
    indentComp.reconfigure(indentExtensions(settings.tabSize)),
    activeLineComp.reconfigure(activeLineExtensions(settings.highlightCurrentLine)),
  ];
}

export function createDocument(text: string, settings: EditorSettings, onUpdate: (state: EditorState) => void): EditorState {
  return EditorState.create({
    doc: text,
    extensions: [
      fontComp.of(fontTheme(settings.fontSize)),
      wrapComp.of(settings.wordWrap ? EditorView.lineWrapping : []),
      gutterComp.of(settings.lineNumbers ? lineNumbers() : []),
      indentComp.of(indentExtensions(settings.tabSize)),
      activeLineComp.of(activeLineExtensions(settings.highlightCurrentLine)),
      history(),
      drawSelection({ cursorBlinkRate: 1200 }),
      EditorView.editable.of(true),
      bracketMatching(),
      highlightSelectionMatches(),
      search({ top: true }),
      chrome,
      EditorView.contentAttributes.of({ spellcheck: "false", "data-enable-grammarcheck": "false" }),
      keymap.of([
        { key: "Mod-y", run: redo, preventDefault: true },
        { key: "Mod-h", run: openReplace, preventDefault: true },
        { key: "Mod-Shift-d", run: duplicateLines, preventDefault: true },
        { key: "Alt-ArrowUp", run: (view) => moveLines(view, -1), preventDefault: true },
        { key: "Alt-ArrowDown", run: (view) => moveLines(view, 1), preventDefault: true },
        indentWithTab,
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
      ]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged || update.selectionSet || update.transactions.some((transaction) => transaction.reconfigured)) {
          onUpdate(update.state);
        }
      }),
    ],
  });
}

export function applySettings(view: EditorView, settings: EditorSettings): EditorState {
  view.dispatch({ effects: settingEffects(settings) });
  return view.state;
}

export function retarget(state: EditorState, settings: EditorSettings): EditorState {
  return state.update({ effects: settingEffects(settings) }).state;
}

export function cursorPosition(state: EditorState): { line: number; column: number } {
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  return { line: line.number, column: head - line.from + 1 };
}

export function runUndo(view: EditorView): void {
  undo(view);
}

export function runRedo(view: EditorView): void {
  redo(view);
}

export function runSelectAll(view: EditorView): void {
  selectAll(view);
}

export function openFind(view: EditorView): void {
  openSearchPanel(view);
  view.focus();
}

export function openReplace(view: EditorView): boolean {
  openSearchPanel(view);
  requestAnimationFrame(() => {
    view.dom.querySelector<HTMLInputElement>('input[name="replace"]')?.focus();
  });
  return true;
}

export async function copySelection(view: EditorView, cut: boolean): Promise<void> {
  const text = view.state.selection.ranges.map((range) => view.state.sliceDoc(range.from, range.to)).join("\n");
  await navigator.clipboard.writeText(text);
  if (!cut || view.state.selection.ranges.every((range) => range.empty)) return;
  view.dispatch(
    view.state.changeByRange((range) => ({
      changes: { from: range.from, to: range.to },
      range: EditorSelection.cursor(range.from),
    })),
  );
}

export async function pasteClipboard(view: EditorView): Promise<void> {
  const text = await navigator.clipboard.readText();
  view.dispatch(view.state.replaceSelection(text));
  view.focus();
}

export function duplicateLines(view: EditorView): boolean {
  const range = view.state.selection.main;
  const doc = view.state.doc;
  let toLine = doc.lineAt(range.to);
  if (!range.empty && range.to === toLine.from && toLine.number > 1) {
    toLine = doc.line(toLine.number - 1);
  }
  const fromLine = doc.lineAt(range.from);
  const text = doc.sliceString(fromLine.from, toLine.to);
  if (toLine.number === doc.lines) {
    const at = toLine.to;
    view.dispatch({
      changes: { from: at, insert: `\n${text}` },
      selection: EditorSelection.range(at + 1, at + 1 + text.length),
    });
  } else {
    const at = doc.line(toLine.number + 1).from;
    view.dispatch({
      changes: { from: at, insert: `${text}\n` },
      selection: EditorSelection.range(at, at + text.length),
    });
  }
  view.focus();
  return true;
}

export function moveLines(view: EditorView, dir: -1 | 1): boolean {
  const range = view.state.selection.main;
  const doc = view.state.doc;
  let toLine = doc.lineAt(range.to);
  if (!range.empty && range.to === toLine.from && toLine.number > 1) {
    toLine = doc.line(toLine.number - 1);
  }
  const fromLine = doc.lineAt(Math.min(range.from, toLine.to));
  if (dir < 0 && fromLine.number === 1) return true;
  if (dir > 0 && toLine.number === doc.lines) return true;

  if (dir < 0) {
    const prev = doc.line(fromLine.number - 1);
    const prevText = doc.sliceString(prev.from, prev.to);
    const blockText = doc.sliceString(fromLine.from, toLine.to);
    const end = toLine.number === doc.lines ? toLine.to : doc.line(toLine.number + 1).from;
    const insert =
      toLine.number === doc.lines
        ? `${blockText}\n${prevText}`
        : `${doc.sliceString(fromLine.from, end)}${doc.sliceString(prev.from, fromLine.from)}`;
    const shift = -(prevText.length + 1);
    view.dispatch({
      changes: { from: prev.from, to: end, insert },
      selection: EditorSelection.range(range.anchor + shift, range.head + shift),
    });
  } else {
    const next = doc.line(toLine.number + 1);
    const nextText = doc.sliceString(next.from, next.to);
    const blockText = doc.sliceString(fromLine.from, toLine.to);
    const end = next.number === doc.lines ? next.to : doc.line(next.number + 1).from;
    const insert =
      next.number === doc.lines
        ? `${nextText}\n${blockText}`
        : `${doc.sliceString(next.from, end)}${doc.sliceString(fromLine.from, next.from)}`;
    const shift = nextText.length + 1;
    view.dispatch({
      changes: { from: fromLine.from, to: end, insert },
      selection: EditorSelection.range(range.anchor + shift, range.head + shift),
    });
  }
  view.focus();
  return true;
}
