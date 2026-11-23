use std::fs::{self, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

const MAX_FILE_BYTES: u64 = 8_000_000;
const MAX_RECENT: usize = 10;

const ERR_CHOOSE_FILE: &str = "Choose a file.";
const ERR_TOO_LARGE: &str = "This file is larger than 8 MB.";
const ERR_UTF8: &str = "This file isn't UTF-8.";
const ERR_NOT_FOUND: &str = "File not found.";
const ERR_READ: &str = "Could not read the file.";
const ERR_SAVE: &str = "Could not save the file.";
const ERR_RECENT_READ: &str = "Could not read recent files.";
const ERR_RECENT_SAVE: &str = "Could not save recent files.";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextDocument {
    pub text: String,
    pub line_ending: String,
}

pub fn read_text_file(path: &Path) -> Result<TextDocument, String> {
    let meta = fs::metadata(path).map_err(map_read_meta_error)?;
    if meta.is_dir() {
        return Err(ERR_CHOOSE_FILE.to_string());
    }
    if meta.len() > MAX_FILE_BYTES {
        return Err(ERR_TOO_LARGE.to_string());
    }

    let file = fs::File::open(path).map_err(map_read_io_error)?;
    let mut bytes = Vec::with_capacity(meta.len() as usize);
    file.take(MAX_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(map_read_io_error)?;
    decode_text(&bytes)
}

fn map_read_meta_error(error: io::Error) -> String {
    if error.kind() == io::ErrorKind::NotFound {
        ERR_NOT_FOUND.to_string()
    } else {
        ERR_READ.to_string()
    }
}

fn map_read_io_error(error: io::Error) -> String {
    match error.kind() {
        io::ErrorKind::NotFound => ERR_NOT_FOUND.to_string(),
        _ => ERR_READ.to_string(),
    }
}

pub fn write_text_file(path: &Path, text: &str, line_ending: &str) -> Result<(), String> {
    let bytes = encode_text(text, line_ending)?;
    atomic_write(path, &bytes)
}

pub fn decode_text(bytes: &[u8]) -> Result<TextDocument, String> {
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err(ERR_TOO_LARGE.to_string());
    }
    let bytes = strip_utf8_bom(bytes);
    let text = std::str::from_utf8(bytes).map_err(|_| ERR_UTF8.to_string())?;
    let line_ending = detect_line_ending(text).to_string();
    let text = normalize_newlines(text);
    Ok(TextDocument { text, line_ending })
}

pub fn encode_text(text: &str, line_ending: &str) -> Result<Vec<u8>, String> {
    let encoded = match line_ending {
        "lf" => text.as_bytes().to_vec(),
        "crlf" => text.replace('\n', "\r\n").into_bytes(),
        _ => return Err(ERR_SAVE.to_string()),
    };
    if encoded.len() as u64 > MAX_FILE_BYTES {
        return Err(ERR_TOO_LARGE.to_string());
    }
    Ok(encoded)
}

fn strip_utf8_bom(bytes: &[u8]) -> &[u8] {
    bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes)
}

/// `\r\n` counts as one CRLF ending. A `\n` that is not part of `\r\n` is a bare LF.
/// The greater count wins. A tie with any CRLF is `"crlf"`. No newlines is `"lf"`.
fn detect_line_ending(text: &str) -> &'static str {
    let bytes = text.as_bytes();
    let mut crlf = 0usize;
    let mut bare_lf = 0usize;
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'\n' => {
                bare_lf += 1;
                index += 1;
            }
            b'\r' if index + 1 < bytes.len() && bytes[index + 1] == b'\n' => {
                crlf += 1;
                index += 2;
            }
            _ => index += 1,
        }
    }
    if crlf > 0 && crlf >= bare_lf {
        "crlf"
    } else {
        "lf"
    }
}

fn normalize_newlines(text: &str) -> String {
    text.replace("\r\n", "\n").replace('\r', "\n")
}

pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    write_atomic(path, bytes).map_err(|_| ERR_SAVE.to_string())
}

fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let parent = destination_parent(path)?;
    let file_name = path
        .file_name()
        .unwrap_or_else(|| std::ffi::OsStr::new("file"));
    let (temp_path, mut temp_file) = create_temp_file(&parent, file_name)?;

    let written = (|| {
        temp_file.write_all(bytes)?;
        temp_file.sync_all()?;
        Ok(())
    })();
    drop(temp_file);

    if let Err(error) = written {
        let _ = fs::remove_file(&temp_path);
        return Err(error);
    }

    if let Err(error) = replace_file(&temp_path, path) {
        let _ = fs::remove_file(&temp_path);
        return Err(error);
    }
    Ok(())
}

fn destination_parent(path: &Path) -> io::Result<PathBuf> {
    match path.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => Ok(parent.to_path_buf()),
        _ => std::env::current_dir(),
    }
}

fn create_temp_file(parent: &Path, file_name: &std::ffi::OsStr) -> io::Result<(PathBuf, fs::File)> {
    let name = file_name.to_string_lossy();
    let pid = std::process::id();
    let mut last_error = None;
    for _ in 0..32 {
        let temp_path = parent.join(format!(".{name}.tmp-{pid}-{}", next_temp_nonce()));
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)
        {
            Ok(file) => return Ok((temp_path, file)),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                last_error = Some(error);
            }
            Err(error) => return Err(error),
        }
    }
    Err(last_error.unwrap_or_else(|| io::Error::other("could not create a temporary file")))
}

fn next_temp_nonce() -> u64 {
    static SEQ: AtomicU64 = AtomicU64::new(1);
    let seq = SEQ.fetch_add(1, Ordering::Relaxed);
    let tick = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos() as u64)
        .unwrap_or(0);
    tick ^ seq.wrapping_mul(0x9E37_79B9_7F4A_7C15)
}

fn replace_file(from: &Path, to: &Path) -> io::Result<()> {
    #[cfg(windows)]
    {
        replace_file_windows(from, to)
    }
    #[cfg(not(windows))]
    {
        fs::rename(from, to)
    }
}

/// `std::fs::rename` cannot replace an existing file on Windows.
#[cfg(windows)]
fn replace_file_windows(from: &Path, to: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    fn wide(path: &Path) -> Vec<u16> {
        path.as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    let from_wide = wide(from);
    let to_wide = wide(to);
    let flags = MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH;
    let moved = unsafe { MoveFileExW(from_wide.as_ptr(), to_wide.as_ptr(), flags) };
    if moved == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

pub fn load_recent(store: &Path) -> Result<Vec<String>, String> {
    let bytes = match fs::read(store) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(_) => return Err(ERR_RECENT_READ.to_string()),
    };
    let parsed: Vec<String> = match serde_json::from_slice(&bytes) {
        Ok(paths) => paths,
        Err(_) => return Ok(Vec::new()),
    };
    let kept: Vec<String> = parsed
        .iter()
        .filter(|path| Path::new(path).is_file())
        .cloned()
        .collect();
    if kept.len() != parsed.len() {
        save_recent(store, &kept)?;
    }
    Ok(kept)
}

pub fn remember_recent(store: &Path, path: &str) -> Result<Vec<String>, String> {
    let mut paths = load_recent(store)?;
    push_recent(&mut paths, path);
    save_recent(store, &paths)?;
    Ok(paths)
}

pub fn forget_recent(store: &Path, path: &str) -> Result<Vec<String>, String> {
    let mut paths = load_recent(store)?;
    let before = paths.len();
    remove_recent(&mut paths, path);
    if paths.len() != before {
        save_recent(store, &paths)?;
    }
    Ok(paths)
}

fn save_recent(store: &Path, paths: &[String]) -> Result<(), String> {
    if let Some(parent) = store.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|_| ERR_RECENT_SAVE.to_string())?;
        }
    }
    let mut bytes = serde_json::to_vec_pretty(paths).map_err(|_| ERR_RECENT_SAVE.to_string())?;
    bytes.push(b'\n');
    write_atomic(store, &bytes).map_err(|_| ERR_RECENT_SAVE.to_string())
}

fn push_recent(list: &mut Vec<String>, path: &str) {
    list.retain(|existing| existing != path);
    list.insert(0, path.to_string());
    list.truncate(MAX_RECENT);
}

fn remove_recent(list: &mut Vec<String>, path: &str) {
    list.retain(|existing| existing != path);
}

pub fn default_line_ending() -> String {
    if cfg!(windows) {
        "crlf".to_string()
    } else {
        "lf".to_string()
    }
}

pub fn startup_files() -> Vec<String> {
    collect_startup_files(std::env::args().skip(1))
}

fn collect_startup_files<I>(args: I) -> Vec<String>
where
    I: IntoIterator,
    I::Item: AsRef<str>,
{
    args.into_iter()
        .map(|arg| arg.as_ref().to_string())
        .filter(|arg| !arg.starts_with('-') && Path::new(arg).is_file())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(label: &str) -> Self {
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|duration| duration.as_nanos())
                .unwrap_or(0);
            let path = std::env::temp_dir().join(format!(
                "text-editor-{label}-{}-{nanos}",
                std::process::id()
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn assert_no_temp_files(dir: &Path) {
        for entry in fs::read_dir(dir).unwrap() {
            let name = entry.unwrap().file_name();
            let name = name.to_string_lossy();
            assert!(
                !name.contains(".tmp-"),
                "temporary file left behind: {name}"
            );
        }
    }

    #[test]
    fn bom_is_stripped_and_not_part_of_text() {
        let doc = decode_text(b"\xEF\xBB\xBFhello").unwrap();
        assert_eq!(doc.text, "hello");
        assert!(!doc.text.starts_with('\u{FEFF}'));
        assert!(!doc.text.contains('\u{FEFF}'));

        let only_bom = decode_text(b"\xEF\xBB\xBF").unwrap();
        assert_eq!(only_bom.text, "");
        assert_eq!(only_bom.line_ending, "lf");
    }

    #[test]
    fn invalid_utf8_returns_the_exact_error() {
        assert_eq!(
            decode_text(&[0x68, 0xFF, 0x69]).unwrap_err(),
            "This file isn't UTF-8."
        );
        assert_eq!(
            decode_text(&[0xEF, 0xBB, 0xBF, 0x80]).unwrap_err(),
            "This file isn't UTF-8."
        );
    }

    #[test]
    fn oversize_bytes_return_the_exact_error() {
        let bytes = vec![b'a'; 8_000_001];
        assert_eq!(
            decode_text(&bytes).unwrap_err(),
            "This file is larger than 8 MB."
        );

        let boundary = vec![b'a'; 8_000_000];
        let doc = decode_text(&boundary).unwrap();
        assert_eq!(doc.text.len(), 8_000_000);
        assert_eq!(doc.line_ending, "lf");
    }

    #[test]
    fn line_endings_are_detected_and_text_is_normalized_to_lf() {
        let lf = decode_text(b"a\nb\n").unwrap();
        assert_eq!(lf.line_ending, "lf");
        assert_eq!(lf.text, "a\nb\n");
        assert!(!lf.text.contains('\r'));

        let crlf = decode_text(b"a\r\nb\r\n").unwrap();
        assert_eq!(crlf.line_ending, "crlf");
        assert_eq!(crlf.text, "a\nb\n");
        assert!(!crlf.text.contains('\r'));

        let tie = decode_text(b"a\r\nb\n").unwrap();
        assert_eq!(tie.line_ending, "crlf");
        assert_eq!(tie.text, "a\nb\n");

        let more_lf = decode_text(b"a\r\nb\nc\n").unwrap();
        assert_eq!(more_lf.line_ending, "lf");
        assert_eq!(more_lf.text, "a\nb\nc\n");

        let more_crlf = decode_text(b"a\r\nb\r\nc\n").unwrap();
        assert_eq!(more_crlf.line_ending, "crlf");
        assert_eq!(more_crlf.text, "a\nb\nc\n");

        let none = decode_text(b"no newlines").unwrap();
        assert_eq!(none.line_ending, "lf");
        assert_eq!(none.text, "no newlines");

        let lone_cr = decode_text(b"a\rb\r\nc").unwrap();
        assert_eq!(lone_cr.text, "a\nb\nc");
        assert!(!lone_cr.text.contains('\r'));
        assert_eq!(lone_cr.line_ending, "crlf");
    }

    #[test]
    fn encode_crlf_turns_newlines_into_crlf_and_does_not_add_a_bom() {
        let encoded = encode_text("a\nb\n", "crlf").unwrap();
        assert_eq!(encoded, b"a\r\nb\r\n");
        assert!(!encoded.starts_with(&[0xEF, 0xBB, 0xBF]));

        assert_eq!(encode_text("a\nb", "lf").unwrap(), b"a\nb");
        assert_eq!(encode_text("", "crlf").unwrap(), b"");
        assert_eq!(
            encode_text("a", "cr").unwrap_err(),
            "Could not save the file."
        );

        let too_big = "\n".repeat(4_000_001);
        assert_eq!(
            encode_text(&too_big, "crlf").unwrap_err(),
            "This file is larger than 8 MB."
        );
    }

    #[test]
    fn atomic_write_creates_and_overwrites_and_contents_round_trip() {
        let dir = TempDir::new("atomic");
        let path = dir.path().join("note.txt");

        atomic_write(&path, b"first\n").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"first\n");

        let encoded = encode_text("second\nline\n", "crlf").unwrap();
        atomic_write(&path, &encoded).unwrap();
        let raw = fs::read(&path).unwrap();
        assert_eq!(raw, b"second\r\nline\r\n");
        assert!(!raw.starts_with(&[0xEF, 0xBB, 0xBF]));

        let doc = read_text_file(&path).unwrap();
        assert_eq!(doc.text, "second\nline\n");
        assert_eq!(doc.line_ending, "crlf");

        write_text_file(&path, "third\n", "lf").unwrap();
        let doc = read_text_file(&path).unwrap();
        assert_eq!(doc.text, "third\n");
        assert_eq!(doc.line_ending, "lf");
        assert_eq!(fs::read(&path).unwrap(), b"third\n");

        assert_no_temp_files(dir.path());
    }

    #[test]
    fn atomic_write_removes_the_temp_file_when_replace_fails() {
        let dir = TempDir::new("atomic-fail");
        let dest = dir.path().join("not-a-file");
        fs::create_dir(&dest).unwrap();

        let error = atomic_write(&dest, b"data").unwrap_err();
        assert_eq!(error, "Could not save the file.");
        assert!(dest.is_dir());
        assert_no_temp_files(dir.path());
    }

    #[test]
    fn read_text_file_rejects_directories_and_oversize_files() {
        let dir = TempDir::new("read");
        let path = dir.path().join("hello.txt");
        fs::write(&path, b"\xEF\xBB\xBFhello\n").unwrap();
        let doc = read_text_file(&path).unwrap();
        assert_eq!(doc.text, "hello\n");
        assert_eq!(doc.line_ending, "lf");
        assert!(!doc.text.contains('\u{FEFF}'));

        assert_eq!(read_text_file(dir.path()).unwrap_err(), "Choose a file.");
        assert_eq!(
            read_text_file(&dir.path().join("missing.txt")).unwrap_err(),
            "File not found."
        );

        let big = dir.path().join("big.bin");
        let file = fs::File::create(&big).unwrap();
        file.set_len(8_000_001).unwrap();
        drop(file);
        assert_eq!(
            read_text_file(&big).unwrap_err(),
            "This file is larger than 8 MB."
        );

        let bad = dir.path().join("bad.txt");
        fs::write(&bad, [0xFF, 0xFE]).unwrap();
        assert_eq!(
            read_text_file(&bad).unwrap_err(),
            "This file isn't UTF-8."
        );
    }

    #[test]
    fn invalid_line_ending_does_not_create_a_file() {
        let dir = TempDir::new("save");
        let path = dir.path().join("note.txt");
        assert_eq!(
            write_text_file(&path, "hi\n", "LF").unwrap_err(),
            "Could not save the file."
        );
        assert!(!path.exists());
    }

    #[test]
    fn recent_push_moves_duplicate_to_front_caps_at_10_and_forget_removes() {
        let mut list = Vec::new();
        for index in 0..10 {
            push_recent(&mut list, &format!("file-{index}"));
        }
        assert_eq!(list.len(), 10);
        assert_eq!(list[0], "file-9");
        assert_eq!(list[9], "file-0");

        push_recent(&mut list, "file-4");
        assert_eq!(list[0], "file-4");
        assert_eq!(list.iter().filter(|path| *path == "file-4").count(), 1);
        assert_eq!(list.len(), 10);
        assert_eq!(list[9], "file-0");

        push_recent(&mut list, "file-new");
        assert_eq!(list.len(), 10);
        assert_eq!(list[0], "file-new");
        assert!(!list.iter().any(|path| path == "file-0"));

        remove_recent(&mut list, "file-new");
        assert!(!list.iter().any(|path| path == "file-new"));
        assert_eq!(list.len(), 9);
        remove_recent(&mut list, "file-new");
        assert_eq!(list.len(), 9);
    }

    #[test]
    fn remember_recent_persists_and_load_drops_missing_files() {
        let dir = TempDir::new("recent");
        let store = dir.path().join("config").join("recent.json");
        let keep = dir.path().join("keep.txt");
        fs::write(&keep, b"ok").unwrap();
        let keep = keep.to_str().unwrap().to_string();

        assert_eq!(remember_recent(&store, &keep).unwrap(), vec![keep.clone()]);

        let gone = dir.path().join("gone.txt");
        fs::write(&gone, b"bye").unwrap();
        let gone = gone.to_str().unwrap().to_string();
        assert_eq!(
            remember_recent(&store, &gone).unwrap(),
            vec![gone.clone(), keep.clone()]
        );

        fs::remove_file(&gone).unwrap();
        assert_eq!(load_recent(&store).unwrap(), vec![keep.clone()]);
        let saved: Vec<String> = serde_json::from_slice(&fs::read(&store).unwrap()).unwrap();
        assert_eq!(saved, vec![keep.clone()]);

        fs::write(&store, b"{not json").unwrap();
        assert!(load_recent(&store).unwrap().is_empty());
        assert!(load_recent(&dir.path().join("missing-recent.json"))
            .unwrap()
            .is_empty());

        assert!(forget_recent(&store, &keep).unwrap().is_empty());
    }

    #[test]
    fn text_document_serializes_line_ending_as_camel_case() {
        let doc = TextDocument {
            text: "a\n".to_string(),
            line_ending: "lf".to_string(),
        };
        let json = serde_json::to_value(&doc).unwrap();
        assert_eq!(json["text"], "a\n");
        assert_eq!(json["lineEnding"], "lf");
        assert!(json.get("line_ending").is_none());
    }

    #[test]
    fn startup_args_keep_existing_files_and_skip_flags() {
        let dir = TempDir::new("startup");
        let file = dir.path().join("opened.txt");
        fs::write(&file, b"hi").unwrap();
        let file = file.to_str().unwrap();
        let missing = dir.path().join("missing.txt");
        let missing = missing.to_str().unwrap();

        let found = collect_startup_files(["--flag", "-n", file, missing, ""]);
        assert_eq!(found, vec![file.to_string()]);
    }

    #[test]
    fn default_line_ending_matches_the_platform() {
        if cfg!(windows) {
            assert_eq!(default_line_ending(), "crlf");
        } else {
            assert_eq!(default_line_ending(), "lf");
        }
    }
}
