mod library;
mod transfer;

use library::RawSnippet;

// Les commandes sont `async` pour s'exécuter hors du thread de l'interface :
// une grosse bibliothèque ne fige jamais la fenêtre.

#[tauri::command]
async fn list_snippets(library: String) -> Result<Vec<RawSnippet>, String> {
    library::list(&library)
}

#[tauri::command]
async fn read_snippet(library: String, id: String) -> Result<RawSnippet, String> {
    library::read(&library, &id)
}

#[tauri::command]
async fn write_snippet(library: String, snippet: RawSnippet) -> Result<(), String> {
    library::write(&library, &snippet)
}

#[tauri::command]
async fn create_snippet(library: String, snippet: RawSnippet) -> Result<(), String> {
    library::create(&library, &snippet)
}

#[tauri::command]
async fn delete_snippet(library: String, id: String) -> Result<(), String> {
    library::delete(&library, &id)
}

#[tauri::command]
async fn export_source(path: String, content: String) -> Result<(), String> {
    library::export_source(&path, &content)
}

#[tauri::command]
async fn read_order(library: String) -> Result<Vec<String>, String> {
    library::read_order(&library)
}

#[tauri::command]
async fn write_order(library: String, order: Vec<String>) -> Result<(), String> {
    library::write_order(&library, &order)
}

#[tauri::command]
async fn read_import_source(path: String) -> Result<transfer::ImportSource, String> {
    transfer::read_import_source(&path)
}

#[tauri::command]
async fn write_export_zip(path: String, files: Vec<transfer::SourceFile>) -> Result<(), String> {
    transfer::write_export_zip(&path, &files)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            list_snippets,
            read_snippet,
            write_snippet,
            create_snippet,
            delete_snippet,
            export_source,
            read_order,
            write_order,
            read_import_source,
            write_export_zip
        ])
        .run(tauri::generate_context!())
        .expect("erreur au lancement de l'application");
}
