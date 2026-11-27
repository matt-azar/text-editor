import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentLess,
  indentMore,
  indentWithTab,
  redo,
  selectAll,
  undo,
} from "@codemirror/commands";
import { bracketMatching, HighlightStyle, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { highlightSelectionMatches, openSearchPanel, search, searchKeymap } from "@codemirror/search";
import { Compartment, EditorSelection, EditorState, Prec, type Extension } from "@codemirror/state";
import {
  Direction,
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  layer,
  lineNumbers,
  type LayerMarker,
} from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import {
  fontStackFor,
  normalizeEditorPadding,
  normalizeLineSpacing,
  normalizeTabSize,
  type CaretWidth,
  type FontFamilyId,
  type StoredEditorSettings,
} from "./state.ts";

export type EditorSettings = StoredEditorSettings;

const fontComp = new Compartment();
const wrapComp = new Compartment();
const gutterComp = new Compartment();
const indentComp = new Compartment();
const layoutComp = new Compartment();
const activeLineComp = new Compartment();
const caretComp = new Compartment();
const themeComp = new Compartment();
const languageComp = new Compartment();
const closeBracketsComp = new Compartment();
const vimComp = new Compartment();
const keymapComp = new Compartment();

/** Syntax colors for the dark editor chrome (#181818). */
const darkHighlight = HighlightStyle.define(
  [
    { tag: t.comment, color: "#6a9955" },
    { tag: t.lineComment, color: "#6a9955" },
    { tag: t.blockComment, color: "#6a9955" },
    { tag: t.docComment, color: "#6a9955" },
    { tag: t.keyword, color: "#569cd6" },
    { tag: t.controlKeyword, color: "#c586c0" },
    { tag: t.moduleKeyword, color: "#c586c0" },
    { tag: t.operatorKeyword, color: "#569cd6" },
    { tag: t.definitionKeyword, color: "#569cd6" },
    { tag: t.modifier, color: "#569cd6" },
    { tag: t.self, color: "#569cd6" },
    { tag: t.atom, color: "#569cd6" },
    { tag: t.bool, color: "#569cd6" },
    { tag: t.null, color: "#569cd6" },
    { tag: t.number, color: "#b5cea8" },
    { tag: t.integer, color: "#b5cea8" },
    { tag: t.float, color: "#b5cea8" },
    { tag: t.string, color: "#ce9178" },
    { tag: t.special(t.string), color: "#d7ba7d" },
    { tag: t.character, color: "#ce9178" },
    { tag: t.regexp, color: "#d16969" },
    { tag: t.escape, color: "#d7ba7d" },
    { tag: t.color, color: "#ce9178" },
    { tag: t.url, color: "#ce9178" },
    { tag: t.typeName, color: "#4ec9b0" },
    { tag: t.className, color: "#4ec9b0" },
    { tag: t.namespace, color: "#4ec9b0" },
    { tag: t.macroName, color: "#4ec9b0" },
    { tag: t.definition(t.typeName), color: "#4ec9b0" },
    { tag: t.function(t.variableName), color: "#dcdcaa" },
    { tag: t.function(t.propertyName), color: "#dcdcaa" },
    { tag: t.definition(t.function(t.variableName)), color: "#dcdcaa" },
    { tag: t.propertyName, color: "#9cdcfe" },
    { tag: t.definition(t.propertyName), color: "#9cdcfe" },
    { tag: t.variableName, color: "#9cdcfe" },
    { tag: t.definition(t.variableName), color: "#9cdcfe" },
    { tag: t.local(t.variableName), color: "#9cdcfe" },
    { tag: t.labelName, color: "#c8c8c8" },
    { tag: t.operator, color: "#d4d4d4" },
    { tag: t.compareOperator, color: "#d4d4d4" },
    { tag: t.arithmeticOperator, color: "#d4d4d4" },
    { tag: t.logicOperator, color: "#d4d4d4" },
    { tag: t.bitwiseOperator, color: "#d4d4d4" },
    { tag: t.punctuation, color: "#d4d4d4" },
    { tag: t.bracket, color: "#ffd700" },
    { tag: t.angleBracket, color: "#808080" },
    { tag: t.squareBracket, color: "#d4d4d4" },
    { tag: t.paren, color: "#d4d4d4" },
    { tag: t.brace, color: "#d4d4d4" },
    { tag: t.separator, color: "#d4d4d4" },
    { tag: t.meta, color: "#c586c0" },
    { tag: t.annotation, color: "#dcdcaa" },
    { tag: t.processingInstruction, color: "#c586c0" },
    { tag: t.heading, color: "#569cd6", fontWeight: "bold" },
    { tag: t.heading1, color: "#569cd6", fontWeight: "bold" },
    { tag: t.heading2, color: "#569cd6", fontWeight: "bold" },
    { tag: t.strong, fontWeight: "bold" },
    { tag: t.emphasis, fontStyle: "italic" },
    { tag: t.strikethrough, textDecoration: "line-through" },
    { tag: t.link, color: "#ce9178" },
    { tag: t.monospace, color: "#ce9178" },
    { tag: t.tagName, color: "#569cd6" },
    { tag: t.attributeName, color: "#9cdcfe" },
    { tag: t.attributeValue, color: "#ce9178" },
    { tag: t.documentMeta, color: "#6a9955" },
    { tag: t.invalid, color: "#f44747" },
  ],
  { themeType: "dark" },
);

/** Syntax colors for the eggshell light editor chrome (#f0ead6). */
const lightHighlight = HighlightStyle.define(
  [
    { tag: t.comment, color: "#6a737d" },
    { tag: t.lineComment, color: "#6a737d" },
    { tag: t.blockComment, color: "#6a737d" },
    { tag: t.docComment, color: "#6a737d" },
    { tag: t.keyword, color: "#0550ae" },
    { tag: t.controlKeyword, color: "#cf222e" },
    { tag: t.moduleKeyword, color: "#cf222e" },
    { tag: t.operatorKeyword, color: "#0550ae" },
    { tag: t.definitionKeyword, color: "#0550ae" },
    { tag: t.modifier, color: "#0550ae" },
    { tag: t.self, color: "#0550ae" },
    { tag: t.atom, color: "#0550ae" },
    { tag: t.bool, color: "#0550ae" },
    { tag: t.null, color: "#0550ae" },
    { tag: t.number, color: "#0550ae" },
    { tag: t.integer, color: "#0550ae" },
    { tag: t.float, color: "#0550ae" },
    { tag: t.string, color: "#0a3069" },
    { tag: t.special(t.string), color: "#0a3069" },
    { tag: t.character, color: "#0a3069" },
    { tag: t.regexp, color: "#116329" },
    { tag: t.escape, color: "#0a3069" },
    { tag: t.color, color: "#0a3069" },
    { tag: t.url, color: "#0a3069" },
    { tag: t.typeName, color: "#953800" },
    { tag: t.className, color: "#953800" },
    { tag: t.namespace, color: "#953800" },
    { tag: t.macroName, color: "#953800" },
    { tag: t.definition(t.typeName), color: "#953800" },
    { tag: t.function(t.variableName), color: "#8250df" },
    { tag: t.function(t.propertyName), color: "#8250df" },
    { tag: t.definition(t.function(t.variableName)), color: "#8250df" },
    { tag: t.propertyName, color: "#0550ae" },
    { tag: t.definition(t.propertyName), color: "#0550ae" },
    { tag: t.variableName, color: "#1e1e1e" },
    { tag: t.definition(t.variableName), color: "#1e1e1e" },
    { tag: t.local(t.variableName), color: "#1e1e1e" },
    { tag: t.labelName, color: "#1e1e1e" },
    { tag: t.operator, color: "#1e1e1e" },
    { tag: t.compareOperator, color: "#1e1e1e" },
    { tag: t.arithmeticOperator, color: "#1e1e1e" },
    { tag: t.logicOperator, color: "#1e1e1e" },
    { tag: t.bitwiseOperator, color: "#1e1e1e" },
    { tag: t.punctuation, color: "#1e1e1e" },
    { tag: t.bracket, color: "#1e1e1e" },
    { tag: t.angleBracket, color: "#6a737d" },
    { tag: t.squareBracket, color: "#1e1e1e" },
    { tag: t.paren, color: "#1e1e1e" },
    { tag: t.brace, color: "#1e1e1e" },
    { tag: t.separator, color: "#1e1e1e" },
    { tag: t.meta, color: "#cf222e" },
    { tag: t.annotation, color: "#8250df" },
    { tag: t.processingInstruction, color: "#cf222e" },
    { tag: t.heading, color: "#0550ae", fontWeight: "bold" },
    { tag: t.heading1, color: "#0550ae", fontWeight: "bold" },
    { tag: t.heading2, color: "#0550ae", fontWeight: "bold" },
    { tag: t.strong, fontWeight: "bold" },
    { tag: t.emphasis, fontStyle: "italic" },
    { tag: t.strikethrough, textDecoration: "line-through" },
    { tag: t.link, color: "#0a3069" },
    { tag: t.monospace, color: "#0a3069" },
    { tag: t.tagName, color: "#116329" },
    { tag: t.attributeName, color: "#0550ae" },
    { tag: t.attributeValue, color: "#0a3069" },
    { tag: t.documentMeta, color: "#6a737d" },
    { tag: t.invalid, color: "#cf222e" },
  ],
  { themeType: "light" },
);

const highlightExtensions: Extension = [
  syntaxHighlighting(darkHighlight),
  syntaxHighlighting(lightHighlight),
];

/** Lazy so default (Vim off) cold start skips `@replit/codemirror-vim`. */
let vimFactory: (() => Extension) | null = null;

/** Load the Vim extension module once; safe to call repeatedly. */
export async function ensureVimLoaded(): Promise<void> {
  if (vimFactory) return;
  const mod = await import("@replit/codemirror-vim");
  vimFactory = mod.vim;
}

function vimExtension(): Extension {
  return vimFactory ? vimFactory() : [];
}

/** Base editor chords; drop Mod-d / Mod-u when Vim is on so Ctrl+d / Ctrl+u half-page scroll. */
function editorKeymap(vimMode: boolean): Extension {
  const historyKeys = vimMode
    ? historyKeymap.filter((binding) => binding.key !== "Mod-u")
    : historyKeymap;
  const searchKeys = vimMode
    ? searchKeymap.filter((binding) => binding.key !== "Mod-d")
    : searchKeymap;
  return keymap.of([
    { key: "Mod-y", run: redo, preventDefault: true },
    { key: "Mod-h", run: openReplace, preventDefault: true },
    { key: "Mod-Shift-d", run: duplicateLines, preventDefault: true },
    { key: "Mod-Shift-Enter", run: insertLineAbove, preventDefault: true },
    { key: "Mod-[", run: outdentLines, preventDefault: true },
    { key: "Mod-]", run: indentLines, preventDefault: true },
    { key: "Alt-ArrowUp", run: (view) => moveLines(view, -1), preventDefault: true },
    { key: "Alt-ArrowDown", run: (view) => moveLines(view, 1), preventDefault: true },
    indentWithTab,
    ...defaultKeymap,
    ...historyKeys,
    ...searchKeys,
  ]);
}

const darkTheme = EditorView.theme(
  {
    "&": {
      height: "100%",
      backgroundColor: "#181818",
      color: "#c8c8c8",
    },
    ".cm-content": {
      caretColor: "#aeafad",
      userSelect: "text",
      "-webkit-user-select": "text",
    },
    ".cm-line": {
      userSelect: "text",
      "-webkit-user-select": "text",
    },
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

/** Eggshell light editor chrome. */
const lightTheme = EditorView.theme(
  {
    "&": {
      height: "100%",
      backgroundColor: "#f0ead6",
      color: "#1e1e1e",
    },
    ".cm-content": {
      caretColor: "#1e1e1e",
      userSelect: "text",
      "-webkit-user-select": "text",
    },
    ".cm-line": {
      userSelect: "text",
      "-webkit-user-select": "text",
    },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground":
      {
        backgroundColor: "#add6ff !important",
      },
    ".cm-selectionLayer .cm-selectionBackground": {
      backgroundColor: "#add6ff !important",
    },
    ".cm-gutters": {
      backgroundColor: "#f0ead6",
      color: "#8a8a8a",
      border: "none",
    },
    ".cm-activeLine, .cm-activeLineGutter": {
      backgroundColor: "rgba(0, 0, 0, 0.045)",
    },
  },
  { dark: false },
);

function fontTheme(family: FontFamilyId, px: number): Extension {
  return EditorView.theme({
    "&": { fontSize: `${px}px` },
    ".cm-scroller": { fontFamily: fontStackFor(family) },
  });
}

function indentExtensions(tabSize: number, insertSpaces: boolean): Extension[] {
  const size = normalizeTabSize(tabSize);
  return [EditorState.tabSize.of(size), indentUnit.of(insertSpaces ? " ".repeat(size) : "\t")];
}

function layoutTheme(lineSpacing: number, editorPadding: number): Extension {
  const spacing = normalizeLineSpacing(lineSpacing);
  const padding = normalizeEditorPadding(editorPadding);
  return EditorView.theme({
    ".cm-scroller": { lineHeight: String(spacing) },
    ".cm-content": { padding: `${padding}px` },
  });
}

function activeLineExtensions(enabled: boolean): Extension[] {
  return enabled ? [highlightActiveLine(), highlightActiveLineGutter()] : [];
}

/** Auto-close `()[]{}` and quotes; wrap selection; Backspace deletes the pair. */
function closeBracketsExtensions(enabled: boolean): Extension[] {
  return enabled ? [closeBrackets(), keymap.of(closeBracketsKeymap)] : [];
}

type GraphemeSegmenter = {
  segment(input: string): Iterable<{ segment: string }>;
};

function graphemeSegmenter(): GraphemeSegmenter | null {
  const Ctor = (
    Intl as unknown as {
      Segmenter?: new (locales: undefined, options: { granularity: "grapheme" }) => GraphemeSegmenter;
    }
  ).Segmenter;
  return Ctor ? new Ctor(undefined, { granularity: "grapheme" }) : null;
}

const graphemes = graphemeSegmenter();

/** The grapheme starting at `text`, or one code point when segmentation is unavailable. */
function characterText(text: string): string {
  if (!text) return "";
  const segmented = graphemes?.segment(text)[Symbol.iterator]().next().value?.segment;
  if (segmented) return segmented;
  const point = text.codePointAt(0) ?? 0;
  return text.slice(0, point > 0xffff ? 2 : 1);
}

/** Glyph to paint inside a block caret. Whitespace has no glyph; the block itself is the cell. */
function caretGlyph(text: string): string {
  const char = characterText(text);
  return /^\s$/u.test(char) ? "" : char;
}

function documentBase(view: EditorView): { left: number; top: number } {
  const rect = view.scrollDOM.getBoundingClientRect();
  const left =
    view.textDirection === Direction.LTR
      ? rect.left
      : rect.right - view.scrollDOM.clientWidth * view.scaleX;
  return {
    left: left - view.scrollDOM.scrollLeft * view.scaleX,
    top: rect.top - view.scrollDOM.scrollTop * view.scaleY,
  };
}

function styleAt(view: EditorView, pos: number): CSSStyleDeclaration {
  const found = view.domAtPos(pos).node;
  const parent = found.parentNode;
  const element = found instanceof HTMLElement ? found : parent instanceof HTMLElement ? parent : view.contentDOM;
  return getComputedStyle(element);
}

function opaqueColor(color: string, fallback: string): string {
  if (!color || color === "transparent" || color === "rgba(0, 0, 0, 0)") return fallback;
  return color;
}

/** One-cell caret that swaps the character and background colors, like a Vim block caret. */
class BlockCaretMarker implements LayerMarker {
  constructor(
    readonly left: number,
    readonly top: number,
    readonly width: number,
    readonly height: number,
    readonly letter: string,
    readonly fontFamily: string,
    readonly fontSize: string,
    readonly fontWeight: string,
    readonly blockColor: string,
    readonly letterColor: string,
  ) {}

  eq(other: LayerMarker): boolean {
    if (!(other instanceof BlockCaretMarker)) return false;
    return (
      this.left === other.left &&
      this.top === other.top &&
      this.width === other.width &&
      this.height === other.height &&
      this.letter === other.letter &&
      this.fontFamily === other.fontFamily &&
      this.fontSize === other.fontSize &&
      this.fontWeight === other.fontWeight &&
      this.blockColor === other.blockColor &&
      this.letterColor === other.letterColor
    );
  }

  draw(): HTMLElement {
    const elt = document.createElement("div");
    elt.className = "cm-block-caret";
    this.adjust(elt);
    return elt;
  }

  update(elt: HTMLElement): boolean {
    this.adjust(elt);
    return true;
  }

  private adjust(elt: HTMLElement): void {
    elt.style.left = `${this.left}px`;
    elt.style.top = `${this.top}px`;
    elt.style.width = `${this.width}px`;
    elt.style.height = `${this.height}px`;
    elt.style.lineHeight = `${this.height}px`;
    elt.style.fontFamily = this.fontFamily;
    elt.style.fontSize = this.fontSize;
    elt.style.fontWeight = this.fontWeight;
    elt.style.backgroundColor = this.blockColor;
    elt.style.color = this.letterColor;
    elt.textContent = this.letter;
  }
}

function blockCaretMarkers(view: EditorView, light: boolean): readonly BlockCaretMarker[] {
  const textFallback = light ? "#1e1e1e" : "#c8c8c8";
  const pageFallback = light ? "#f0ead6" : "#181818";
  const pageColor = opaqueColor(getComputedStyle(view.dom).backgroundColor, pageFallback);
  const base = documentBase(view);
  const markers: BlockCaretMarker[] = [];
  for (const range of view.state.selection.ranges) {
    const head = range.head;
    const line = view.state.doc.lineAt(head);
    const style = styleAt(view, head);
    const blockColor = opaqueColor(style.color, textFallback);
    const charRect = head < line.to ? view.coordsForChar(head) : null;
    let left: number;
    let top: number;
    let width: number;
    let height: number;
    if (charRect && charRect.right > charRect.left && charRect.bottom > charRect.top) {
      left = (charRect.left - base.left) / view.scaleX;
      top = (charRect.top - base.top) / view.scaleY;
      width = (charRect.right - charRect.left) / view.scaleX;
      height = (charRect.bottom - charRect.top) / view.scaleY;
    } else {
      const caret = view.coordsAtPos(head, 1);
      if (!caret) continue;
      left = (caret.left - base.left) / view.scaleX;
      top = (caret.top - base.top) / view.scaleY;
      width = view.defaultCharacterWidth;
      height = (caret.bottom - caret.top) / view.scaleY;
    }
    if (width <= 0 || height <= 0) continue;
    const letter = head < line.to ? caretGlyph(view.state.sliceDoc(head, line.to)) : "";
    markers.push(
      new BlockCaretMarker(
        left,
        top,
        width,
        height,
        letter,
        style.fontFamily,
        style.fontSize,
        style.fontWeight,
        blockColor,
        pageColor,
      ),
    );
  }
  return markers;
}

function blockCaretLayer(light: boolean): Extension {
  return layer({
    above: true,
    class: "cm-block-caret-layer",
    update(update, dom) {
      if (update.transactions.some((tr) => tr.selection)) {
        dom.style.animationName = dom.style.animationName === "cm-blink" ? "cm-blink2" : "cm-blink";
      }
      return (
        update.docChanged ||
        update.selectionSet ||
        update.geometryChanged ||
        update.viewportChanged ||
        update.transactions.some((tr) => tr.reconfigured)
      );
    },
    markers(view) {
      return blockCaretMarkers(view, light);
    },
  });
}

function caretColor(light: boolean): string {
  return light ? "#1e1e1e" : "#aeafad";
}

/** Vim paints its block caret in the text color. Reverse it so the glyph stays readable, matching our block caret. */
function vimCaretColor(): Extension {
  return Prec.highest(
    EditorView.theme({
      ".cm-fat-cursor": {
        backgroundColor: "var(--text) !important",
        color: "var(--bg) !important",
      },
      "&:not(.cm-focused) .cm-fat-cursor": {
        backgroundColor: "transparent !important",
        color: "transparent !important",
        outline: "1px solid var(--text) !important",
      },
    }),
  );
}

function caretExtensions(blink: boolean, width: CaretWidth, light: boolean, vimMode: boolean): Extension[] {
  const barWidth = width === "block" ? 2 : width;
  const color = caretColor(light);
  const bar = {
    borderLeftWidth: `${barWidth}px`,
    marginLeft: `${-(barWidth / 2)}px`,
    borderLeftColor: color,
  };
  // Vim mode draws its own caret. A second block here would sit on top of it.
  const useBlock = width === "block" && !vimMode;
  const caretTheme: Record<string, Record<string, string>> = useBlock
    ? {
        ".cm-content, .cm-line": {
          fontVariantLigatures: "none",
          fontFeatureSettings: '"liga" 0, "calt" 0',
        },
        ".cm-cursor": {
          borderLeftWidth: "0px",
          borderLeftColor: "transparent",
          marginLeft: "0px",
        },
        ".cm-dropCursor": bar,
        ".cm-block-caret-layer": { pointerEvents: "none" },
        ".cm-block-caret": {
          display: "none",
          margin: "0",
          padding: "0",
          overflow: "hidden",
          whiteSpace: "pre",
          pointerEvents: "none",
        },
        "&.cm-focused .cm-block-caret": { display: "block" },
      }
    : {
        ".cm-cursor, .cm-dropCursor": bar,
      };
  if (!blink) {
    caretTheme["&.cm-focused > .cm-scroller > .cm-cursorLayer"] = {
      animationName: "none",
      animationDuration: "0s",
    };
  }
  if (useBlock && blink) {
    caretTheme["&.cm-focused > .cm-scroller > .cm-block-caret-layer"] = {
      animation: "steps(1) cm-blink 1.2s infinite",
    };
  }
  return [
    drawSelection({ cursorBlinkRate: blink ? 1200 : 0 }),
    EditorView.theme(caretTheme),
    vimCaretColor(),
    ...(useBlock ? [blockCaretLayer(light)] : []),
  ];
}

function settingEffects(settings: EditorSettings, lightMode: boolean) {
  return [
    fontComp.reconfigure(fontTheme(settings.fontFamily, settings.fontSize)),
    wrapComp.reconfigure(settings.wordWrap ? EditorView.lineWrapping : []),
    gutterComp.reconfigure(settings.lineNumbers ? lineNumbers() : []),
    indentComp.reconfigure(indentExtensions(settings.tabSize, settings.insertSpaces)),
    layoutComp.reconfigure(layoutTheme(settings.lineSpacing, settings.editorPadding)),
    activeLineComp.reconfigure(activeLineExtensions(settings.highlightCurrentLine)),
    caretComp.reconfigure(caretExtensions(settings.caretBlink, settings.caretWidth, lightMode, settings.vimMode)),
    themeComp.reconfigure(lightMode ? lightTheme : darkTheme),
    closeBracketsComp.reconfigure(closeBracketsExtensions(settings.autoCloseBrackets)),
    vimComp.reconfigure(settings.vimMode ? vimExtension() : []),
    keymapComp.reconfigure(editorKeymap(settings.vimMode)),
  ];
}

export function createDocument(
  text: string,
  settings: EditorSettings,
  onUpdate: (state: EditorState) => void,
  lightMode = false,
): EditorState {
  return EditorState.create({
    doc: text,
    extensions: [
      fontComp.of(fontTheme(settings.fontFamily, settings.fontSize)),
      wrapComp.of(settings.wordWrap ? EditorView.lineWrapping : []),
      gutterComp.of(settings.lineNumbers ? lineNumbers() : []),
      indentComp.of(indentExtensions(settings.tabSize, settings.insertSpaces)),
      layoutComp.of(layoutTheme(settings.lineSpacing, settings.editorPadding)),
      activeLineComp.of(activeLineExtensions(settings.highlightCurrentLine)),
      caretComp.of(caretExtensions(settings.caretBlink, settings.caretWidth, lightMode, settings.vimMode)),
      themeComp.of(lightMode ? lightTheme : darkTheme),
      languageComp.of([]),
      highlightExtensions,
      closeBracketsComp.of(closeBracketsExtensions(settings.autoCloseBrackets)),
      vimComp.of(settings.vimMode ? vimExtension() : []),
      history(),
      EditorView.editable.of(true),
      bracketMatching(),
      highlightSelectionMatches(),
      search({ top: true }),
      EditorView.contentAttributes.of({ spellcheck: "false", "data-enable-grammarcheck": "false" }),
      keymapComp.of(editorKeymap(settings.vimMode)),
      EditorView.updateListener.of((update) => {
        if (update.docChanged || update.selectionSet || update.transactions.some((transaction) => transaction.reconfigured)) {
          onUpdate(update.state);
        }
      }),
    ],
  });
}

export function applySettings(view: EditorView, settings: EditorSettings, lightMode = false): EditorState {
  view.dispatch({ effects: settingEffects(settings, lightMode) });
  return view.state;
}

export function retarget(state: EditorState, settings: EditorSettings, lightMode = false): EditorState {
  return state.update({ effects: settingEffects(settings, lightMode) }).state;
}

/** Swap the language support on a live view (active tab). */
export function applyLanguage(view: EditorView, language: Extension): EditorState {
  view.dispatch({ effects: languageComp.reconfigure(language) });
  return view.state;
}

/** Swap the language support on a detached editor state (inactive tab). */
export function retargetLanguage(state: EditorState, language: Extension): EditorState {
  return state.update({ effects: languageComp.reconfigure(language) }).state;
}

export function caretPosition(state: EditorState): { line: number; column: number } {
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

/** Insert an empty line above the caret line; place the caret on it (VS Code style). */
export function insertLineAbove(view: EditorView): boolean {
  const { state } = view;
  if (state.readOnly) return false;
  const range = state.selection.main;
  const line = state.doc.lineAt(Math.min(range.from, range.to));
  const indent = /^\s*/.exec(line.text)?.[0] ?? "";
  const at = line.from;
  view.dispatch({
    changes: { from: at, insert: `${indent}${state.lineBreak}` },
    selection: EditorSelection.cursor(at + indent.length),
    scrollIntoView: true,
    userEvent: "input",
  });
  view.focus();
  return true;
}

export function indentLines(view: EditorView): boolean {
  return indentMore(view);
}

export function outdentLines(view: EditorView): boolean {
  return indentLess(view);
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
