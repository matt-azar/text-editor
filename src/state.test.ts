import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fileName,
  isDirty,
  nextUntitled,
  pushRecent,
  windowTitle,
} from "./state.ts";

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
