//! Lecture des sources d'import (zip, dossier ou fichier) et écriture des zip d'export.
//!
//! Le Rust ne fait que transporter des fichiers texte : la reconnaissance des formats
//! (snippets PLC Snippets, sources TIA…) se fait côté TypeScript, dans `src/core/io`.
//!
//! Protections :
//! - zip : chemins hors de l'archive (`../`, absolus) refusés, taille et nombre de fichiers
//!   plafonnés (archives piégées), fichiers système ignorés (__MACOSX, .DS_Store, Thumbs.db) ;
//! - export : chemins relatifs simples uniquement, extension .zip obligatoire.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{Read, Write};
use std::path::{Component, Path};

pub const MAX_FILES: usize = 2000;
pub const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
pub const MAX_TOTAL_BYTES: u64 = 20 * 1024 * 1024;
const MAX_DEPTH: usize = 5;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SourceFile {
    /// Chemin relatif, séparateur « / ».
    pub path: String,
    pub content: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSource {
    /// "zip", "dir" ou "file"
    pub kind: String,
    /// Nom du fichier ou du dossier importé.
    pub name: String,
    pub files: Vec<SourceFile>,
    /// Fichiers ignorés, avec la raison (affichés dans l'aperçu).
    pub skipped: Vec<String>,
}

fn is_noise(name: &str) -> bool {
    name.starts_with('.')
        || name == "__MACOSX"
        || name.eq_ignore_ascii_case("Thumbs.db")
        || name == "desktop.ini"
}

/// Texte UTF-8 (BOM retiré) ; à défaut Windows-1252, l'encodage « ANSI » de TIA en français.
/// Un fichier avec des octets de contrôle (binaire) n'est pas du texte : None.
fn decode(bytes: Vec<u8>) -> Option<String> {
    match String::from_utf8(bytes) {
        Ok(text) => Some(
            text.strip_prefix('\u{feff}')
                .map(str::to_owned)
                .unwrap_or(text),
        ),
        Err(e) => {
            let bytes = e.into_bytes();
            if bytes
                .iter()
                .any(|&b| b < 0x20 && !matches!(b, b'\t' | b'\n' | b'\r'))
            {
                return None;
            }
            Some(bytes.iter().map(|&b| windows_1252(b)).collect())
        }
    }
}

fn windows_1252(b: u8) -> char {
    const HIGH: [char; 32] = [
        '€', '\u{81}', '‚', 'ƒ', '„', '…', '†', '‡', 'ˆ', '‰', 'Š', '‹', 'Œ', '\u{8d}', 'Ž',
        '\u{8f}', '\u{90}', '‘', '’', '“', '”', '•', '–', '—', '˜', '™', 'š', '›', 'œ', '\u{9d}',
        'ž', 'Ÿ',
    ];
    match b {
        0x80..=0x9f => HIGH[(b - 0x80) as usize],
        _ => b as char,
    }
}

struct Collector {
    files: Vec<SourceFile>,
    skipped: Vec<String>,
    total: u64,
}

impl Collector {
    fn new() -> Self {
        Self {
            files: Vec::new(),
            skipped: Vec::new(),
            total: 0,
        }
    }

    /// Ajoute un fichier ; Err si une limite globale est atteinte (import abandonné).
    fn add(
        &mut self,
        path: String,
        size: u64,
        read: impl FnOnce() -> std::io::Result<Vec<u8>>,
    ) -> Result<(), String> {
        if self.files.len() >= MAX_FILES {
            return Err(format!(
                "Trop de fichiers (plus de {MAX_FILES}) : import abandonné"
            ));
        }
        if size > MAX_FILE_BYTES {
            self.skipped
                .push(format!("{path} : trop gros ({} Ko)", size / 1024));
            return Ok(());
        }
        let bytes = read().map_err(|e| format!("Lecture de {path} : {e}"))?;
        if bytes.len() as u64 > MAX_FILE_BYTES {
            self.skipped.push(format!("{path} : trop gros"));
            return Ok(());
        }
        self.total += bytes.len() as u64;
        if self.total > MAX_TOTAL_BYTES {
            return Err(format!(
                "Contenu trop volumineux (plus de {} Mo) : import abandonné",
                MAX_TOTAL_BYTES / 1024 / 1024
            ));
        }
        match decode(bytes) {
            Some(content) => self.files.push(SourceFile { path, content }),
            None => self.skipped.push(format!("{path} : pas un fichier texte")),
        }
        Ok(())
    }
}

fn walk(dir: &Path, prefix: &str, depth: usize, out: &mut Collector) -> Result<(), String> {
    if depth > MAX_DEPTH {
        return Ok(());
    }
    let mut entries: Vec<_> = fs::read_dir(dir)
        .map_err(|e| format!("Lecture du dossier {} : {e}", dir.display()))?
        .flatten()
        .collect();
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        if is_noise(&name) {
            continue;
        }
        let rel = if prefix.is_empty() {
            name.clone()
        } else {
            format!("{prefix}/{name}")
        };
        let path = entry.path();
        // Pas de liens symboliques : on reste dans le dossier choisi.
        let Ok(meta) = fs::symlink_metadata(&path) else {
            continue;
        };
        if meta.is_dir() {
            walk(&path, &rel, depth + 1, out)?;
        } else if meta.is_file() {
            out.add(rel, meta.len(), || fs::read(&path))?;
        }
    }
    Ok(())
}

fn read_zip(path: &Path, out: &mut Collector) -> Result<(), String> {
    let file = fs::File::open(path).map_err(|e| format!("Ouverture du zip : {e}"))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("Zip illisible : {e}"))?;
    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("Zip illisible : {e}"))?;
        let raw_name = entry
            .name()
            .map(|n| n.to_string())
            .unwrap_or_else(|_| format!("entrée {i}"));
        if entry.is_dir() {
            continue;
        }
        let Some(safe) = entry.enclosed_name() else {
            out.skipped
                .push(format!("{raw_name} : chemin refusé (sort de l'archive)"));
            continue;
        };
        let parts: Vec<String> = safe
            .components()
            .filter_map(|c| match c {
                Component::Normal(s) => s.to_str().map(str::to_owned),
                _ => None,
            })
            .collect();
        if parts.is_empty() || parts.iter().any(|p| is_noise(p)) || parts.len() > MAX_DEPTH + 1 {
            continue;
        }
        let rel = parts.join("/");
        let declared = entry.size();
        out.add(rel, declared, || {
            // On ne fait pas confiance à la taille annoncée : lecture plafonnée.
            let mut bytes = Vec::new();
            (&mut entry)
                .take(MAX_FILE_BYTES + 1)
                .read_to_end(&mut bytes)?;
            Ok(bytes)
        })?;
    }
    Ok(())
}

pub fn read_import_source(path: &str) -> Result<ImportSource, String> {
    let path = Path::new(path);
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("import")
        .to_owned();
    let mut out = Collector::new();
    let kind = if path.is_dir() {
        walk(path, "", 0, &mut out)?;
        "dir"
    } else if path.is_file() {
        let is_zip = path
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| e.eq_ignore_ascii_case("zip"));
        if is_zip {
            read_zip(path, &mut out)?;
            "zip"
        } else {
            let size = fs::metadata(path).map(|m| m.len()).unwrap_or(0);
            out.add(name.clone(), size, || fs::read(path))?;
            "file"
        }
    } else {
        return Err(format!("Introuvable : {}", path.display()));
    };
    Ok(ImportSource {
        kind: kind.into(),
        name,
        files: out.files,
        skipped: out.skipped,
    })
}

fn is_safe_relative(path: &str) -> bool {
    !path.is_empty()
        && !path.contains('\\')
        && !path.starts_with('/')
        && Path::new(path)
            .components()
            .all(|c| matches!(c, Component::Normal(_)))
}

pub fn write_export_zip(path: &str, files: &[SourceFile]) -> Result<(), String> {
    let path = Path::new(path);
    let is_zip = path
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("zip"));
    if !is_zip {
        return Err("L'export de partage doit être un fichier .zip".into());
    }
    if let Some(bad) = files.iter().find(|f| !is_safe_relative(&f.path)) {
        return Err(format!("Chemin interdit dans l'export : {}", bad.path));
    }
    let file =
        fs::File::create(path).map_err(|e| format!("Création de {} : {e}", path.display()))?;
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    for f in files {
        zip.start_file(f.path.as_str(), options)
            .map_err(|e| e.to_string())?;
        zip.write_all(f.content.as_bytes())
            .map_err(|e| e.to_string())?;
    }
    zip.finish().map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn decode_utf8_bom_et_windows_1252() {
        assert_eq!(
            super::decode("\u{feff}// Réseau".as_bytes().to_vec()).as_deref(),
            Some("// Réseau")
        );
        // « // Réseau – pièce » en Windows-1252
        let ansi = b"// R\xe9seau \x96 pi\xe8ce".to_vec();
        assert_eq!(super::decode(ansi).as_deref(), Some("// Réseau – pièce"));
        assert_eq!(super::decode(vec![0x00, 0x9f, 0x01]), None);
    }

    use super::*;
    use std::path::PathBuf;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("plc-transfer-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn file(path: &str, content: &str) -> SourceFile {
        SourceFile {
            path: path.into(),
            content: content.into(),
        }
    }

    #[test]
    fn zip_roundtrip() {
        let dir = temp("roundtrip");
        let zip_path = dir.join("pack.zip");
        let files = vec![
            file("tempo/snippet.json", "{\"schemaVersion\":1}"),
            file("tempo/main.scl", "#a := TRUE; // é"),
        ];
        write_export_zip(zip_path.to_str().unwrap(), &files).unwrap();
        let source = read_import_source(zip_path.to_str().unwrap()).unwrap();
        assert_eq!(source.kind, "zip");
        assert_eq!(source.name, "pack.zip");
        assert_eq!(source.files, files);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn zip_refuses_escaping_paths_and_skips_noise() {
        let dir = temp("evil");
        let zip_path = dir.join("evil.zip");
        let f = fs::File::create(&zip_path).unwrap();
        let mut zip = zip::ZipWriter::new(f);
        let opts = zip::write::SimpleFileOptions::default();
        for (name, content) in [
            ("../evil.scl", "x"),
            ("/abs.scl", "y"),
            ("__MACOSX/a/._snippet.json", "z"),
            ("ok/main.scl", "ok"),
            ("ok/.DS_Store", "n"),
        ] {
            zip.start_file(name, opts).unwrap();
            zip.write_all(content.as_bytes()).unwrap();
        }
        zip.finish().unwrap();

        let source = read_import_source(zip_path.to_str().unwrap()).unwrap();
        let paths: Vec<_> = source.files.iter().map(|f| f.path.as_str()).collect();
        assert!(paths.contains(&"ok/main.scl"));
        assert!(
            !paths
                .iter()
                .any(|p| p.contains("evil") || p.contains("MACOSX") || p.contains("DS_Store"))
        );
        assert!(source.skipped.iter().any(|s| s.contains("../evil.scl")));
        assert!(!dir.parent().unwrap().join("evil.scl").exists());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn reads_folders_recursively_and_skips_binaries() {
        let dir = temp("folder");
        fs::create_dir_all(dir.join("lib/a")).unwrap();
        fs::create_dir_all(dir.join("lib/.git")).unwrap();
        fs::write(dir.join("lib/a/snippet.json"), "{}").unwrap();
        fs::write(dir.join("lib/a/main.lad"), "\u{feff}NO \"A\" -> COIL \"B\"").unwrap();
        fs::write(dir.join("lib/.git/config"), "x").unwrap();
        fs::write(dir.join("lib/image.png"), [0xff, 0xd8, 0x00, 0x9f]).unwrap();

        let source = read_import_source(dir.join("lib").to_str().unwrap()).unwrap();
        assert_eq!(source.kind, "dir");
        assert_eq!(
            source.files,
            vec![
                file("a/main.lad", "NO \"A\" -> COIL \"B\""),
                file("a/snippet.json", "{}")
            ]
        );
        assert_eq!(
            source.skipped,
            vec!["image.png : pas un fichier texte".to_string()]
        );
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn reads_a_single_file_and_rejects_bad_exports() {
        let dir = temp("single");
        let scl = dir.join("FB_Test.scl");
        fs::write(&scl, "FUNCTION_BLOCK \"FB_Test\"").unwrap();
        let source = read_import_source(scl.to_str().unwrap()).unwrap();
        assert_eq!((source.kind.as_str(), source.files.len()), ("file", 1));
        assert_eq!(source.files[0].path, "FB_Test.scl");

        let target = dir.join("out.zip");
        assert!(write_export_zip(target.to_str().unwrap(), &[file("../x", "")]).is_err());
        assert!(write_export_zip(target.to_str().unwrap(), &[file("a\\b", "")]).is_err());
        assert!(write_export_zip(dir.join("out.txt").to_str().unwrap(), &[file("a", "")]).is_err());
        fs::remove_dir_all(dir).unwrap();
    }
}
