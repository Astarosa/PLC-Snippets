mod library;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            list_snippets,
            read_snippet,
            write_snippet,
            create_snippet,
            delete_snippet,
            export_source
        ])
        .run(tauri::generate_context!())
        .expect("erreur au lancement de l'application");
}
