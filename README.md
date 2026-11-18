# PLC Snippets

Bibliothèque de snippets automate façon Gists : LADDER et son équivalent SCL,
ou SCL seul pour ce qui n'a pas d'équivalent LADDER lisible.
Application de bureau Windows (Tauri 2 + React 19).

## Prérequis (Windows)

1. **Node.js 24** (LTS) : <https://nodejs.org>. La version est fixée dans `.nvmrc`
2. **Rust** via rustup : <https://rustup.rs> (puis `rustup update`, il faut Rust 1.88 minimum)
3. **Microsoft C++ Build Tools** : dans Visual Studio Installer, cocher
   « Développement Desktop en C++ » (MSVC + SDK Windows)
4. **WebView2** : déjà présent sur Windows 11

## Commandes

```bash
npm install            # une seule fois
npm run tauri dev      # lance l'app en développement (rechargement à chaud)
npm run tauri build    # produit l'installeur .exe (et le .msi)
npm test               # tests du cœur TypeScript (Vitest)
npm run test:rust      # tests de l'accès disque (Rust)
npm run check          # Biome (lint + format) + vérification des types
```

Après `npm run tauri build`, l'installeur est dans
`src-tauri/target/release/bundle/nsis/PLC Snippets_0.1.0_x64-setup.exe`.
Il s'installe **sans droits administrateur** (`installMode: currentUser`).
L'exécutable seul (version portable) est `src-tauri/target/release/plc-snippets.exe`.

> L'exe n'est pas signé : au premier lancement, Windows SmartScreen affiche
> « Windows a protégé votre ordinateur » → *Informations complémentaires* → *Exécuter quand même*.

## Build automatique (GitHub Actions)

Le workflow `.github/workflows/build.yml` tourne sur un runner Windows :

- **à chaque push sur `main` ou PR** : lint, tests TS et Rust, build. L'installeur se
  télécharge dans l'onglet *Actions* → le run → *Artifacts* → `plc-snippets-windows`
  (contient le setup .exe, le .msi et l'exe portable) ;
- **sur un tag `v*`** : même chose, plus une **Release GitHub en brouillon** avec les installeurs.

Publier une version :

1. Mettre le même numéro dans `package.json`, `src-tauri/tauri.conf.json` et `src-tauri/Cargo.toml`
2. `git commit -am "chore: v0.2.0"`, puis `git tag v0.2.0 && git push && git push --tags`
3. Sur GitHub, relire la Release brouillon et la publier

## Organisation du code

```
src/
├── core/snippet/        ← logique pure, testée (aucune dépendance à Tauri)
│   ├── schema.ts          format de snippet.json (Zod)
│   ├── parse.ts           validation, slug, recherche
│   └── form.ts            formulaire ↔ snippet, règles de validation
├── core/ladder/         ← DSL LADDER, sans dépendance
│   ├── parse.ts           lexer + parseur, erreurs ligne / colonne
│   ├── scl.ts             génération du SCL équivalent
│   └── layout.ts          mise en page du schéma (formes en pixels)
├── storage/
│   ├── repository.ts      contrat SnippetRepository
│   ├── tauri-repository.ts  implémentation disque (commandes Rust)
│   ├── queries.ts         hooks TanStack Query
│   └── sample-library.ts  snippets d'exemple
├── state/settings.ts    ← réglages persistés (dossier de bibliothèque)
├── features/
│   ├── editor/            formulaire, CodeMirror (coloration SCL / LAD), éditeur d'interface
│   ├── ladder/            dessin SVG du schéma, aperçu avec erreurs
│   ├── library/           liste, recherche, écran d'accueil
│   └── snippet/           page d'un snippet, tableau d'interface
└── components/          ← CodeBlock, CopyButton, Badge

src-tauri/src/
├── lib.rs               ← commandes : list / read / create / write / delete_snippet
└── library.rs           ← lecture/écriture des dossiers, écriture atomique, anti « ../ »
```

Règle : le Rust ne fait que des fichiers. Toute la logique métier (schéma,
DSL LADDER, génération SCL) vit dans `src/core`, en TypeScript testable.

## Format d'une bibliothèque

Une bibliothèque est un dossier, chaque sous-dossier est un snippet :

```
MaBibliotheque/
└── marche-arret-auto-maintien/
    ├── snippet.json   métadonnées (voir src/core/snippet/schema.ts)
    ├── README.md      notes (optionnel)
    ├── main.lad       DSL LADDER (optionnel)
    └── main.scl       CORPS du bloc SCL (sans l'interface)
```

- Le nom du dossier est l'identifiant : minuscules, chiffres, `-` et `_`.
- `snippet.json` décrit l'interface (`input`, `output`, `inOut`, `static`, `temp`, `constant`)
  et liste les variantes : `{ "lang": "SCL", "file": "main.scl" }`.
- Un snippet mal formé n'est pas ignoré en silence : il apparaît dans
  « Snippets illisibles » avec la liste des erreurs.

Le dossier peut vivre dans Nextcloud (synchronisation) et devenir un dépôt git (historique).

## Feuille de route

- [x] **1. Squelette** : choix du dossier, lecture, liste, recherche, détail, copie, build .exe
- [x] **2a. Édition** : créer / modifier / supprimer, éditeur CodeMirror avec coloration SCL et LADDER,
      éditeur d'interface, validation avant écriture
- [ ] **2b.** Rendu Markdown des notes, index SQLite FTS5
- [ ] **3. Historique** : commit git automatique (isomorphic-git), vue diff
- [x] **4. DSL LADDER** : parseur, rendu SVG, génération SCL de la logique combinatoire
      (syntaxe : [docs/ladder-dsl.md](docs/ladder-dsl.md))
- [ ] **5. Boîtes** (TON, CTU, MOVE…), export `.scl` complet, version portable

L'icône est générée depuis `app-icon.png` : `npx tauri icon app-icon.png`.
