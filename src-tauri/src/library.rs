//! Accès disque à la bibliothèque de snippets.
//!
//! Une bibliothèque est un dossier. Chaque sous-dossier contenant un
//! `snippet.json` est un snippet :
//!
//! ```text
//! MaBibliotheque/
//! └── marche-arret-auto-maintien/
//!     ├── snippet.json   (métadonnées, validées côté TypeScript)
//!     ├── README.md      (description, optionnelle)
//!     ├── main.lad       (DSL LADDER, optionnel)
//!     └── main.scl
//! ```
//!
//! Le Rust reste volontairement « bête » : il lit et écrit des fichiers et
//! vérifie que les noms sont sûrs. Toute la logique métier (schéma, parsing
//! du LADDER, génération SCL) vit dans `src/core` côté TypeScript.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

pub const META_FILE: &str = "snippet.json";
/// Réglages de la bibliothèque (ordre d'affichage…), à sa racine : synchronisé avec elle.
pub const LIBRARY_FILE: &str = "library.json";
pub const README_FILE: &str = "README.md";
/// Extensions des fichiers de code reconnus.
pub const CODE_EXTENSIONS: [&str; 3] = ["lad", "scl", "awl"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SnippetFile {
    pub name: String,
    pub content: String,
}

/// Snippet tel qu'il est sur le disque, sans interprétation.
/// `meta` est le contenu brut de `snippet.json`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RawSnippet {
    pub id: String,
    pub meta: String,
    pub readme: Option<String>,
    pub files: Vec<SnippetFile>,
}

/// Identifiant = nom du dossier : minuscules, chiffres, `-` et `_`.
/// Empêche toute sortie du dossier de bibliothèque (`..`, `/`, `\`).
pub fn is_valid_id(id: &str) -> bool {
    let mut chars = id.chars();
    match chars.next() {
        Some(c) if c.is_ascii_lowercase() || c.is_ascii_digit() => {}
        _ => return false,
    }
    id.len() <= 80
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_')
}

/// Nom de fichier de code : `<id valide>.lad` ou `<id valide>.scl`.
pub fn is_valid_code_file(name: &str) -> bool {
    match name.rsplit_once('.') {
        Some((stem, ext)) => is_valid_id(stem) && CODE_EXTENSIONS.contains(&ext),
        None => false,
    }
}

fn library_dir(library: &str) -> Result<PathBuf, String> {
    let dir = PathBuf::from(library);
    if !dir.is_dir() {
        return Err(format!(
            "Le dossier de bibliothèque est introuvable : {library}"
        ));
    }
    Ok(dir)
}

fn snippet_dir(library: &str, id: &str) -> Result<PathBuf, String> {
    if !is_valid_id(id) {
        return Err(format!("Identifiant de snippet invalide : « {id} »"));
    }
    Ok(library_dir(library)?.join(id))
}

/// Écrit dans un fichier temporaire puis renomme : un plantage en pleine
/// écriture ne laisse jamais un fichier à moitié écrit.
fn write_atomic(path: &Path, content: &str) -> Result<(), String> {
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("Nom de fichier invalide")?;
    let tmp = path.with_file_name(format!(".{file_name}.tmp"));
    fs::write(&tmp, content).map_err(|e| format!("Écriture de {}: {e}", tmp.display()))?;
    fs::rename(&tmp, path).map_err(|e| format!("Renommage vers {}: {e}", path.display()))
}

fn read_snippet_dir(dir: &Path, id: &str) -> Result<RawSnippet, String> {
    let meta = fs::read_to_string(dir.join(META_FILE))
        .map_err(|e| format!("Lecture de {id}/{META_FILE}: {e}"))?;
    let readme = fs::read_to_string(dir.join(README_FILE)).ok();

    let mut files = Vec::new();
    let entries = fs::read_dir(dir).map_err(|e| format!("Lecture du dossier {id}: {e}"))?;
    for entry in entries.flatten() {
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        if entry.path().is_file() && is_valid_code_file(&name) {
            let content = fs::read_to_string(entry.path())
                .map_err(|e| format!("Lecture de {id}/{name}: {e}"))?;
            files.push(SnippetFile { name, content });
        }
    }
    files.sort_by(|a, b| a.name.cmp(&b.name));

    Ok(RawSnippet {
        id: id.to_owned(),
        meta,
        readme,
        files,
    })
}

pub fn list(library: &str) -> Result<Vec<RawSnippet>, String> {
    let dir = library_dir(library)?;
    let entries = fs::read_dir(&dir).map_err(|e| format!("Lecture de la bibliothèque: {e}"))?;

    let mut snippets = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(id) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        // Ignore les dossiers cachés (.git, index…) et ceux qui ne sont pas des snippets.
        if !path.is_dir() || !is_valid_id(&id) || !path.join(META_FILE).is_file() {
            continue;
        }
        snippets.push(read_snippet_dir(&path, &id)?);
    }
    snippets.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(snippets)
}

pub fn read(library: &str, id: &str) -> Result<RawSnippet, String> {
    let dir = snippet_dir(library, id)?;
    read_snippet_dir(&dir, id)
}

/// Crée ou remplace un snippet. Les fichiers de code présents sur le disque
/// mais absents de `snippet.files` sont supprimés (variante retirée).
pub fn write(library: &str, snippet: &RawSnippet) -> Result<(), String> {
    let dir = snippet_dir(library, &snippet.id)?;
    for file in &snippet.files {
        if !is_valid_code_file(&file.name) {
            return Err(format!(
                "Nom de fichier de code invalide : « {} »",
                file.name
            ));
        }
    }

    fs::create_dir_all(&dir).map_err(|e| format!("Création du dossier {}: {e}", snippet.id))?;
    write_atomic(&dir.join(META_FILE), &snippet.meta)?;

    match &snippet.readme {
        Some(readme) => write_atomic(&dir.join(README_FILE), readme)?,
        None => {
            let _ = fs::remove_file(dir.join(README_FILE));
        }
    }

    for file in &snippet.files {
        write_atomic(&dir.join(&file.name), &file.content)?;
    }

    // Nettoyage des variantes retirées.
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            if let Some(name) = entry.file_name().to_str()
                && is_valid_code_file(name)
                && !snippet.files.iter().any(|f| f.name == name)
            {
                let _ = fs::remove_file(entry.path());
            }
        }
    }
    Ok(())
}

/// Crée un nouveau snippet. Refuse si le dossier existe déjà, pour ne jamais
/// écraser un snippet existant par erreur (deux titres donnant le même identifiant).
pub fn create(library: &str, snippet: &RawSnippet) -> Result<(), String> {
    let dir = snippet_dir(library, &snippet.id)?;
    if dir.exists() {
        return Err(format!(
            "Un snippet « {} » existe déjà dans la bibliothèque",
            snippet.id
        ));
    }
    write(library, snippet)
}

/// Supprime un snippet (le dossier entier).
pub fn delete(library: &str, id: &str) -> Result<(), String> {
    let dir = snippet_dir(library, id)?;
    if !dir.join(META_FILE).is_file() {
        return Err(format!(
            "« {id} » n'est pas un snippet de cette bibliothèque"
        ));
    }
    fs::remove_dir_all(&dir).map_err(|e| format!("Suppression de {id}: {e}"))
}

/// Écrit une source exportée à l'emplacement choisi par l'utilisateur (boîte « Enregistrer sous »).
/// Seules les extensions de fichiers TIA sont acceptées (.scl, .awl, .xml SimaticML).
pub fn export_source(path: &str, content: &str) -> Result<(), String> {
    let path = Path::new(path);
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase);
    if !matches!(ext.as_deref(), Some("scl" | "awl" | "xml")) {
        return Err("L'export doit être un fichier .scl, .awl ou .xml".into());
    }
    // Les sources .scl / .awl ont besoin du BOM UTF-8 : sans lui, TIA les lit en Windows-1252
    // et les accents deviennent « Ã© ». Le .xml déclare son encodage dans l'en-tête.
    let bytes = if ext.as_deref() == Some("xml") {
        content.as_bytes().to_vec()
    } else {
        [
            &b"\xEF\xBB\xBF"[..],
            content.trim_start_matches('\u{feff}').as_bytes(),
        ]
        .concat()
    };
    fs::write(path, bytes).map_err(|e| format!("Écriture de {}: {e}", path.display()))
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct LibrarySettings {
    #[serde(default)]
    order: Vec<String>,
}

/// Ordre d'affichage des snippets (identifiants). Vide si jamais réglé.
pub fn read_order(library: &str) -> Result<Vec<String>, String> {
    let path = library_dir(library)?.join(LIBRARY_FILE);
    match fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str::<LibrarySettings>(&text)
            .map(|s| s.order)
            .map_err(|e| format!("{LIBRARY_FILE} illisible : {e}")),
        Err(_) => Ok(Vec::new()),
    }
}

pub fn write_order(library: &str, order: &[String]) -> Result<(), String> {
    let path = library_dir(library)?.join(LIBRARY_FILE);
    let order: Vec<String> = order.iter().filter(|id| is_valid_id(id)).cloned().collect();
    let json =
        serde_json::to_string_pretty(&LibrarySettings { order }).map_err(|e| e.to_string())?;
    write_atomic(&path, &format!("{json}\n"))
}

#[cfg(test)]
mod tests {
    #[test]
    fn export_source_ajoute_le_bom_utf8_aux_sources() {
        let dir = std::env::temp_dir().join(format!("plc-bom-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let scl = dir.join("FC_Test.scl");
        super::export_source(scl.to_str().unwrap(), "// Réseau").unwrap();
        assert_eq!(
            std::fs::read(&scl).unwrap(),
            b"\xEF\xBB\xBF// R\xC3\xA9seau"
        );
        let xml = dir.join("FC_Test.xml");
        super::export_source(xml.to_str().unwrap(), "<?xml?>").unwrap();
        assert_eq!(std::fs::read(&xml).unwrap(), b"<?xml?>");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    use super::*;

    fn temp_library(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("plc-snippets-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn sample(id: &str) -> RawSnippet {
        RawSnippet {
            id: id.into(),
            meta: r#"{"title":"Test"}"#.into(),
            readme: Some("# Test".into()),
            files: vec![
                SnippetFile {
                    name: "main.lad".into(),
                    content: "network".into(),
                },
                SnippetFile {
                    name: "main.scl".into(),
                    content: "#a := TRUE;".into(),
                },
            ],
        }
    }

    #[test]
    fn validates_ids() {
        assert!(is_valid_id("marche-arret_01"));
        assert!(!is_valid_id(""));
        assert!(!is_valid_id(".git"));
        assert!(!is_valid_id("../evil"));
        assert!(!is_valid_id("a/b"));
        assert!(!is_valid_id("Majuscule"));
        assert!(!is_valid_id("-tiret-en-tete"));
    }

    #[test]
    fn validates_code_files() {
        assert!(is_valid_code_file("main.scl"));
        assert!(is_valid_code_file("main.lad"));
        assert!(is_valid_code_file("main.awl"));
        assert!(!is_valid_code_file("main.exe"));
        assert!(!is_valid_code_file("../main.scl"));
        assert!(!is_valid_code_file("main"));
    }

    #[test]
    fn write_then_list_roundtrip() {
        let lib = temp_library("roundtrip");
        let lib_str = lib.to_str().unwrap();
        write(lib_str, &sample("b-snippet")).unwrap();
        write(lib_str, &sample("a-snippet")).unwrap();
        fs::create_dir_all(lib.join(".git")).unwrap();
        fs::create_dir_all(lib.join("pas-un-snippet")).unwrap();

        let all = list(lib_str).unwrap();
        assert_eq!(
            all.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(),
            ["a-snippet", "b-snippet"]
        );
        assert_eq!(all[0], sample("a-snippet"));
        fs::remove_dir_all(lib).unwrap();
    }

    #[test]
    fn rewrite_removes_dropped_variants_and_readme() {
        let lib = temp_library("rewrite");
        let lib_str = lib.to_str().unwrap();
        write(lib_str, &sample("x")).unwrap();

        let mut updated = sample("x");
        updated.readme = None;
        updated.files.retain(|f| f.name == "main.scl");
        write(lib_str, &updated).unwrap();

        assert_eq!(read(lib_str, "x").unwrap(), updated);
        assert!(!lib.join("x").join("main.lad").exists());
        fs::remove_dir_all(lib).unwrap();
    }

    #[test]
    fn create_refuses_to_overwrite() {
        let lib = temp_library("create");
        let lib_str = lib.to_str().unwrap();
        create(lib_str, &sample("x")).unwrap();
        assert!(create(lib_str, &sample("x")).is_err());
        fs::remove_dir_all(lib).unwrap();
    }

    #[test]
    fn delete_removes_only_snippets() {
        let lib = temp_library("delete");
        let lib_str = lib.to_str().unwrap();
        write(lib_str, &sample("x")).unwrap();
        fs::create_dir_all(lib.join("autre-dossier")).unwrap();

        delete(lib_str, "x").unwrap();
        assert!(!lib.join("x").exists());
        assert!(delete(lib_str, "autre-dossier").is_err());
        assert!(lib.join("autre-dossier").exists());
        assert!(delete(lib_str, "..").is_err());
        fs::remove_dir_all(lib).unwrap();
    }

    #[test]
    fn export_accepts_only_tia_sources() {
        let lib = temp_library("export");
        let ok = lib.join("FB_Test.SCL");
        export_source(ok.to_str().unwrap(), "FUNCTION_BLOCK").unwrap();
        assert_eq!(fs::read_to_string(&ok).unwrap(), "\u{feff}FUNCTION_BLOCK");
        assert!(export_source(lib.join("x.exe").to_str().unwrap(), "x").is_err());
        assert!(export_source(lib.join("sans-extension").to_str().unwrap(), "x").is_err());
        fs::remove_dir_all(lib).unwrap();
    }

    #[test]
    fn order_roundtrip_and_defaults() {
        let lib = temp_library("order");
        let lib_str = lib.to_str().unwrap();
        assert_eq!(read_order(lib_str).unwrap(), Vec::<String>::new());
        write_order(lib_str, &["b".into(), "../evil".into(), "a".into()]).unwrap();
        assert_eq!(
            read_order(lib_str).unwrap(),
            vec!["b".to_string(), "a".to_string()]
        );
        // library.json n'est pas un snippet
        assert!(list(lib_str).unwrap().is_empty());
        fs::remove_dir_all(lib).unwrap();
    }

    #[test]
    fn rejects_path_traversal() {
        let lib = temp_library("traversal");
        let lib_str = lib.to_str().unwrap();
        assert!(read(lib_str, "../etc").is_err());
        let mut bad = sample("ok");
        bad.files[0].name = "../../evil.scl".into();
        assert!(write(lib_str, &bad).is_err());
        fs::remove_dir_all(lib).unwrap();
    }
}
