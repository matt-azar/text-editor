mod files;

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use files::TextDocument;
use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, FilePath};

/// Serializes read-modify-write of `{app_config_dir}/recent.json`.
struct RecentFiles {
    gate: Mutex<()>,
}

const TEXT_EXTENSIONS: &[&str] = &[
    "txt", "md", "json", "log", "csv", "rs", "ts", "js", "css", "html", "toml", "yml", "yaml",
];

#[tauri::command]
fn read_text(path: String) -> Result<TextDocument, String> {
    files::read_text_file(Path::new(&path))
}

#[tauri::command]
fn write_text(path: String, text: String, line_ending: String) -> Result<(), String> {
    files::write_text_file(Path::new(&path), &text, &line_ending)
}

#[tauri::command]
async fn pick_open_path(app: tauri::AppHandle) -> Result<Option<String>, String> {
    pick_path("Could not open the file dialog.", move || {
        app.dialog()
            .file()
            .set_title("Open")
            .add_filter("All files", &["*"])
            .add_filter("Text", TEXT_EXTENSIONS)
            .blocking_pick_file()
    })
    .await
}

#[tauri::command]
async fn pick_save_path(
    app: tauri::AppHandle,
    suggested_name: String,
) -> Result<Option<String>, String> {
    let suggested_name = if suggested_name.is_empty() {
        "Untitled.txt".to_string()
    } else {
        suggested_name
    };
    pick_path("Could not open the save dialog.", move || {
        app.dialog()
            .file()
            .set_title("Save As")
            .add_filter("All files", &["*"])
            .add_filter("Text", TEXT_EXTENSIONS)
            .set_file_name(suggested_name)
            .blocking_save_file()
    })
    .await
}

#[tauri::command]
fn load_recent(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    with_recent(&app, files::load_recent)
}

#[tauri::command]
fn remember_recent(app: tauri::AppHandle, path: String) -> Result<Vec<String>, String> {
    with_recent(&app, |store| files::remember_recent(store, &path))
}

#[tauri::command]
fn forget_recent(app: tauri::AppHandle, path: String) -> Result<Vec<String>, String> {
    with_recent(&app, |store| files::forget_recent(store, &path))
}

#[tauri::command]
fn default_line_ending() -> String {
    files::default_line_ending()
}

#[tauri::command]
fn startup_files() -> Vec<String> {
    files::startup_files()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(RecentFiles {
            gate: Mutex::new(()),
        })
        .invoke_handler(tauri::generate_handler![
            read_text,
            write_text,
            pick_open_path,
            pick_save_path,
            load_recent,
            remember_recent,
            forget_recent,
            default_line_ending,
            startup_files,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

async fn pick_path<F>(dialog_error: &'static str, pick: F) -> Result<Option<String>, String>
where
    F: FnOnce() -> Option<FilePath> + Send + 'static,
{
    let picked = tauri::async_runtime::spawn_blocking(pick)
        .await
        .map_err(|_| dialog_error.to_string())?;
    match picked {
        Some(path) => file_path_to_string(path).map(Some),
        None => Ok(None),
    }
}

fn file_path_to_string(path: FilePath) -> Result<String, String> {
    let path = path
        .simplified()
        .into_path()
        .map_err(|_| "Could not read the selected path.".to_string())?;
    path.into_os_string()
        .into_string()
        .map_err(|_| "Could not read the selected path.".to_string())
}

fn with_recent<T>(
    app: &tauri::AppHandle,
    op: impl FnOnce(&Path) -> Result<T, String>,
) -> Result<T, String> {
    let state = app.state::<RecentFiles>();
    let _guard = state
        .gate
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let store = recent_store_path(app)?;
    op(&store)
}

fn recent_store_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join("recent.json"))
        .map_err(|_| "Could not find the config folder.".to_string())
}
