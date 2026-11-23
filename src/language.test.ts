import assert from "node:assert/strict";
import { test } from "node:test";
import { languageFileName, languageForPath, languageSupportForPath } from "./language.ts";

test("languageFileName uses the last path segment", () => {
  assert.equal(languageFileName("C:\\src\\app.py"), "app.py");
  assert.equal(languageFileName("/home/matt/main.rs"), "main.rs");
  assert.equal(languageFileName("notes.txt"), "notes.txt");
  assert.equal(languageFileName(null), null);
  assert.equal(languageFileName(""), null);
});

test("languageForPath matches common extensions", () => {
  assert.equal(languageForPath("app.js")?.name, "JavaScript");
  assert.equal(languageForPath("app.ts")?.name, "TypeScript");
  assert.equal(languageForPath("App.tsx")?.name, "TSX");
  assert.equal(languageForPath("main.py")?.name, "Python");
  assert.equal(languageForPath("lib.rs")?.name, "Rust");
  assert.equal(languageForPath("main.go")?.name, "Go");
  assert.equal(languageForPath("Main.java")?.name, "Java");
  assert.equal(languageForPath("main.c")?.name, "C");
  assert.equal(languageForPath("main.cpp")?.name, "C++");
  assert.equal(languageForPath("Program.cs")?.name, "C#");
  assert.equal(languageForPath("data.json")?.name, "JSON");
  assert.equal(languageForPath("index.html")?.name, "HTML");
  assert.equal(languageForPath("styles.css")?.name, "CSS");
  assert.equal(languageForPath("README.md")?.name, "Markdown");
  assert.equal(languageForPath("query.sql")?.name, "SQL");
  assert.equal(languageForPath("run.sh")?.name, "Shell");
  assert.equal(languageForPath("config.yaml")?.name, "YAML");
  assert.equal(languageForPath("Cargo.toml")?.name, "TOML");
  assert.equal(languageForPath("pom.xml")?.name, "XML");
});

test("languageForPath matches special filenames", () => {
  assert.equal(languageForPath("Dockerfile")?.name, "Dockerfile");
  assert.equal(languageForPath("dockerfile")?.name, "Dockerfile");
  assert.equal(languageForPath("Dockerfile.dev")?.name, "Dockerfile");
  assert.equal(languageForPath("Makefile")?.name, "Makefile");
  assert.equal(languageForPath("GNUmakefile")?.name, "Makefile");
});

test("languageForPath leaves plain text and unknown extensions unhighlighted", () => {
  assert.equal(languageForPath("notes.txt"), null);
  assert.equal(languageForPath("Untitled"), null);
  assert.equal(languageForPath("data.xyz"), null);
  assert.equal(languageForPath(null), null);
});

test("languageSupportForPath loads a known language and returns empty for plain text", async () => {
  const python = await languageSupportForPath("app.py");
  assert.ok(python);
  const plain = await languageSupportForPath("notes.txt");
  assert.deepEqual(plain, []);
});
