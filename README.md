# PLC Snippets

Bibliothèque de snippets automate façon Gists : LADDER, SCL et LIST (STL / AWL),
avec génération du SCL et du LIST depuis le LADDER, conversion des mnémoniques LIST allemand ↔ anglais
et export en source externe TIA Portal (.scl / .awl).
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

- **à chaque PR et push sur `main`** : lint, tests TS et Rust (~1 min 30). Rien ne tourne si
  seuls des `.md` ou `docs/` changent ;
- **sur `main` (après fusion) ou à la demande** (*Actions → Build Windows → Run workflow*, sur
  n'importe quelle branche) : en plus, un installeur de test, compilé sans LTO pour aller vite.
  Il se télécharge dans l'onglet *Actions* → le run → *Artifacts* → `plc-snippets-windows`
  (setup .exe et exe portable). L'installeur publié, optimisé et signé, vient de la release ;
- **workflow « Publier une version »** (onglet *Actions* → *Run workflow*) : publie une release
  complète, sans passer par le formulaire de release ni créer de tag à la main.

Publier une version :

1. Ajouter la section `## vX.Y.Z` dans [CHANGELOG.md](CHANGELOG.md) (les nouveautés, plusieurs lignes
   possibles) et la pousser sur `main`.
2. *Actions → Publier une version → Run workflow*, saisir `X.Y.Z` (et un titre si on veut).
3. La CI vérifie que le tag est libre et que les nouveautés existent, lance les tests, met la version
   partout (`scripts/set-version.mjs`, commit sur `main`), compile et signe, crée la release en
   brouillon avec l'installeur et `latest.json`, vérifie les fichiers, puis la **publie**.

Les releases du dépôt sont **immuables** une fois publiées (réglage GitHub) : c'est pour ça que tout est
ajouté pendant le brouillon. Un tag déjà utilisé ne peut pas resservir, même si la release est supprimée.

### Mise à jour automatique

À l'ouverture, l'app lit `latest.json` de la dernière release publique
(`releases/latest/download/latest.json`). Si la version est plus récente, une notification propose
**Mettre à jour** (téléchargement, installation, redémarrage) ou **Plus tard** (redemandé au prochain
lancement). Les nouveautés affichées sont le texte de la release.

Les mises à jour sont signées (clé Tauri, différente d'une signature de code Windows) :

- clé publique : `plugins.updater.pubkey` dans `src-tauri/tauri.conf.json` ;
- clé privée et mot de passe : secrets GitHub `TAURI_SIGNING_PRIVATE_KEY` et
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. **À sauvegarder** : sans elle, les apps installées ne
  peuvent plus être mises à jour (il faudrait réinstaller à la main avec une nouvelle clé).

## Organisation du code

```
src/
├── core/snippet/        ← logique pure, testée (aucune dépendance à Tauri)
│   ├── schema.ts          format de snippet.json (Zod)
│   ├── parse.ts           validation, slug, recherche
│   └── form.ts            formulaire ↔ snippet, règles de validation
├── core/export/         ← source externe TIA (.scl / .awl)
├── core/io/             ← import / export : un adaptateur par format, aperçu, doublons
├── core/snippet/migrate.ts ← migrations du format (voir CONTRIBUTING.md)
├── core/stl/            ← conversion des mnémoniques LIST allemand ↔ anglais
├── core/ladder/         ← DSL LADDER, sans dépendance
│   ├── parse.ts           lexer + parseur, erreurs ligne / colonne
│   ├── scl.ts             génération du SCL équivalent
│   ├── stl.ts             génération du LIST équivalent (S7-300/400, S7-1500)
│   ├── layout.ts          mise en page du schéma (formes en pixels, adresse de chaque élément)
│   ├── print.ts           arbre → texte DSL (utilisé par l'éditeur visuel)
│   └── edit.ts            opérations d'édition : insérer, brancher, remplacer, supprimer
├── storage/
│   ├── repository.ts      contrat SnippetRepository
│   ├── tauri-repository.ts  implémentation disque (commandes Rust)
│   ├── queries.ts         hooks TanStack Query
│   └── sample-library.ts  snippets d'exemple
├── state/settings.ts    ← réglages persistés (dossier de bibliothèque)
├── features/
│   ├── editor/            formulaire, CodeMirror (coloration SCL / LAD), éditeur d'interface
│   ├── ladder/            dessin SVG, éditeur visuel (palette, zones de dépôt, inspecteur)
│   ├── library/           liste, recherche, écran d'accueil
│   └── snippet/           page d'un snippet, tableau d'interface
└── components/          ← CodeBlock, CopyButton, Badge

src-tauri/src/
├── lib.rs               ← commandes : list / read / create / write / delete_snippet, export_source
├── library.rs           ← lecture/écriture des dossiers, écriture atomique, anti « ../ »
└── transfer.rs          ← lecture des zip / dossiers à importer, écriture des zip d'export
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
    ├── main.scl       CORPS du bloc SCL (sans l'interface)
    └── main.awl       LIST (optionnel), mnémonique enregistrée dans snippet.json
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
- [x] **5. Boîtes et fronts** : TON / TOF / TP / TONR, CTU / CTD / CTUD, MOVE, ADD / SUB / MUL / DIV,
      fronts P / N, comparateurs, rendu et génération SCL
- [x] **6. Export TIA** : bloc FB / FC complet avec interface, en `.scl` ou `.awl`
      (NETWORK exporté en FC) ; variante **LIST** avec conversion allemand ↔ anglais
- [x] **7. LADDER en drag & drop** : palette de symboles, dépôt en série / parallèle / bobine,
      inspecteur d'opérandes et de paramètres, synchronisé avec le texte DSL
- [x] **8. Import / export et partage** : zip PLC Snippets (complet), sources TIA .scl / .awl
      (import et export), formats versionnés avec migrations
- [~] **9.** SimaticML (fait, validé en V20), PLCopen XML (fait, corps en ST, à valider dans
      Machine Expert / CODESYS), rendu Markdown des notes

L'icône est générée depuis `app-icon.png` : `npx tauri icon app-icon.png`.

## Import, export et partage entre amis

### Importer — un seul bouton, le format est reconnu tout seul

**Importer ▾** (en haut de la liste) → *Un fichier…* ou *Un dossier…*, ou **glisser** un fichier / dossier
sur la fenêtre. Formats reconnus :

| Source | Contenu |
|---|---|
| zip ou dossier PLC Snippets | un snippet, plusieurs, ou une bibliothèque entière (format **complet**) |
| source externe TIA `.scl` / `.awl` | chaque FB / FC devient un snippet (interface + corps ; **passerelle avec perte**) |
| SimaticML TIA `.xml` (bloc LAD) | un bloc par fichier : LADDER, SCL généré, interface, titres et commentaires ; **expérimental** |

Un aperçu montre ce qui a été reconnu, ce qui sera perdu, et propose pour chaque doublon :
*Garder les deux* (dossier renommé `-2`), *Remplacer le mien* ou *Ignorer*.
Les zips sont contrôlés côté Rust (chemins hors archive refusés, taille plafonnée).

### Exporter — un menu par destination

**Exporter ▾** sur la page d'un snippet, ou en bas de la liste après *Sélectionner…* pour plusieurs snippets :

| Famille | Format | Conserve |
|---|---|---|
| Partager | PLC Snippets (.zip) | tout : variantes, notes, commentaires, tags |
| TIA Portal | Source externe SCL (.scl) | SCL seul (généré depuis le LADDER si besoin) |
| TIA Portal | Source externe LIST (.awl) | LIST seul (généré depuis le LADDER si besoin), dans la mnémonique choisie |
| TIA Portal | SimaticML (.xml), validé en V20 | LADDER : bloc LAD avec réseaux, titres, commentaires, interface |
| Schneider / CODESYS | PLCopen XML (.xml), à valider | interface, variables globales, code en ST (traduit du SCL) |

Pour partager avec un ami : **toujours le zip** (le seul format complet).

Dans TIA : *Sources externes* → *Ajouter un nouveau fichier externe* → clic droit → *Générer les blocs*.
Un NETWORK devient une FC sans interface (ses variables globales doivent exister dans l'API).

Dans CODESYS / Machine Expert : *Projet* → *Importer PLCopenXML*. Un FB devient un FUNCTION_BLOCK, une FC
une FUNCTION (retour BOOL), un NETWORK un PROGRAM ; le corps est en ST, traduit du SCL (`#Locale` →
`Locale`, `"Tag"` → `Tag`, `"T".TON(…)` → `T(…)`). Les variables API et les DB d'instance vont dans la
liste globale `GVL_PLCSnippets`. Seuls les bits d'E/S gardent leur adresse (`%I0.0` → `%IX0.0`) : CODESYS
numérote les mots autrement que TIA, les autres adresses sont notées en commentaire.

### SimaticML (LADDER ↔ TIA)

- **Depuis TIA** : obtenir le `.xml` d'un bloc LAD (en V17 : *Version Control Interface* — espace de travail
  qui écrit chaque bloc en SimaticML — ou un outil Openness), puis l'importer ici. Sont repris : contacts NO / NC, fronts P / N, bobines, S / R, OU,
  TON / TOF / TP / TONR, CTU / CTD / CTUD, MOVE, ADD / SUB / MUL / DIV, comparateurs.
  Un réseau contenant autre chose est ignoré avec un avertissement (le reste du bloc est importé).
- **Vers TIA** : *Exporter ▾ → SimaticML (.xml)*, déposer le fichier dans l'espace de travail VCI (ou l'importer
  via Openness), puis le synchroniser vers le projet.
  Le bloc reçoit le numéro 1 : à renuméroter si besoin. Les adresses absolues (`%I0.0`) sont refusées :
  utiliser des mnémoniques.
- L'export vise **TIA V20** (format relevé sur un vrai export V20, `fixtures/simaticml/real-v20/`).
  Le reste des tests repose sur des fichiers synthétiques (`fixtures/simaticml/synthetic-v17/`).
  Un fichier généré a été réimporté avec succès dans TIA V20 : l'export V20 est validé. La V17 n'est pas
  validée (signalée à l'export).

### Compatibilité entre versions de l'application

Chaque snippet porte `schemaVersion`. Un snippet plus ancien est migré automatiquement à la lecture ;
un snippet plus récent que l'application est refusé avec un message demandant de la mettre à jour.
Les règles pour faire évoluer le format sont dans [CONTRIBUTING.md](CONTRIBUTING.md).

## Mnémoniques LIST

La conversion se fait par position (instruction en début de ligne, puis opérande), pas par
rechercher / remplacer : `A` est l'instruction ET en anglais mais une sortie en allemand.

| Allemand | Anglais | | Allemand | Anglais |
|---|---|---|---|---|
| `U`, `UN`, `U(` | `A`, `AN`, `A(` | | `E 0.0`, `EW 10` | `I 0.0`, `IW 10` |
| `SPA`, `SPB`, `SPBN` | `JU`, `JC`, `JCN` | | `A 4.0`, `AW 20` | `Q 4.0`, `QW 20` |
| `AUF`, `BEA`, `BEB` | `OPN`, `BEU`, `BEC` | | `PEW`, `PAW` | `PIW`, `PQW` |
| `ZV`, `ZR` | `CU`, `CD` | | `Z 3` | `C 3` |
| `SI`, `SV`, `SE`, `SA` | `SP`, `SE`, `SD`, `SF` | | | |

Mnémoniques, variables locales, mémentos (`M`), DB et constantes sont laissés tels quels.

## Éditeur LADDER visuel

L'éditeur d'un snippet a deux zones : à gauche le **programme** (onglets LADDER / SCL / LIST, chacun
avec son interrupteur « Généré depuis le LADDER »), à droite un **panneau** (Élément / Interface /
Variables API / Problèmes). La barre du haut reste visible : **Infos** (titre, tags, type de bloc,
CPU, notes), état des contrôles, **Enregistrer** (Ctrl+S). La bibliothèque se replie en rail pendant
l'édition.

Onglet LADDER, mode **Visuel** (le mode **Texte** reste disponible) :

- **Ajouter** : glisser un symbole de la palette vers une zone bleue, ou **cliquer** le symbole puis la zone.
  - petites zones à gauche / à droite d'un élément : insertion **en série**
  - zone sous un élément : nouvelle **branche parallèle**
  - colonne des bobines : bobine supplémentaire sur le rung
  - « nouveau rung », « nouveau réseau »
- **Déplacer** : glisser un élément déjà posé (contact, boîte, bobine) vers une zone bleue.
- **Supprimer** : sélectionner puis **Suppr**, bouton *Supprimer*, ou glisser l'élément sur la **corbeille**.
  Boutons *Supprimer le rung* et *Supprimer le réseau* pour le reste.
- **Branche parallèle autour de plusieurs éléments** : clic sur le premier, **Maj + clic** sur le dernier,
  puis *Branche parallèle autour* (ou glisser un symbole dans la zone sous la sélection).
- **Modifier** : clic sur un élément, puis l'onglet **Élément** du panneau (opérande, NO/NC, paramètres de boîte,
  variables API de l'élément à déclarer).
  Pas de guillemets à taper : `Moteur`, `Mot clé` ou `DB_Ligne.Marche` deviennent `"Moteur"`, `"Mot clé"`, `"DB_Ligne".Marche`.
- **Problèmes** : onglet du panneau ; un clic sélectionne l'élément en cause dans le schéma.
- **Annuler / rétablir** : Ctrl+Z / Ctrl+Y, ou les boutons ↶ ↷.
- **Renommer une variable** : changer son nom dans l'onglet Interface ou Variables API, puis
  *Renommer partout* pour le reporter dans le LADDER, le SCL et le LIST (pas dans les commentaires).
- **Variables API depuis TIA** : *Importer .xlsx* dans l'onglet Variables API, avec une table exportée de TIA
  (Variables API → Exporter). Les variables déjà déclarées récupèrent l'adresse et le commentaire manquants.
- **Commentaires** de réseau (sous le titre) et de rung (dans le panneau) : écrits en `//` dans le fichier
  LADDER, rattachés à leur réseau ou rung, affichés sur le schéma et repris dans le SCL généré.

Le texte DSL reste la référence : chaque modification visuelle le réécrit dans un format standard.

### Simulation

Sur la page d'un snippet, **▶ Simuler** fait tourner le LADDER en cycles, comme la CPU : chaque réseau
dans l'ordre, les bobines écrites tout de suite. Le courant s'affiche sur le schéma (vert = il passe,
pointillés = coupé) et les valeurs numériques à côté des opérandes.

- **Forcer une entrée** : clic sur le contact dans le schéma, ou dans le pupitre (*Entrées*). Les
  valeurs numériques (comparateurs, calculs) se saisissent au pupitre.
- **Sorties et mémoires** : bobines, bits de front, sorties de boîtes, et l'état des instances
  (`"T".ET`, `"C".CV`…).
- Temporisations en temps réel (TON, TOF, TP, TONR), compteurs (CTU, CTD, CTUD), fronts P / N,
  comparateurs, MOVE, ADD / SUB / MUL / DIV. **Pause** fige le temps ; **Réinitialiser** remet tout à zéro.

C'est une aide pour relire la logique, pas PLCSIM : pas de types stricts (débordements, Real / Int),
pas de temps de cycle réel, ni de périphérie. À valider sous PLCSIM ou sur la machine.

## Bibliothèque, thème et raccourcis

- **Imprimer / PDF** (menu ⋯ ou Ctrl+P sur la page d'un snippet) : fiche claire avec schéma, interface,
  variables API, codes et notes. Pour un PDF : imprimante « Microsoft Print to PDF ».
- **Nouveau snippet** (Ctrl+N) : partir de zéro ou d'un modèle (marche / arrêt, tempo, alarme, comptage,
  seuils, FB moteur), puis adapter les noms et les adresses.
- **Filtres** sous la recherche : type de bloc, langage, tags (cliquer un tag sur la page d'un snippet filtre
  la bibliothèque). Un ⛔ signale les snippets dont le LADDER bloquerait l'export TIA.
- **Accueil** : derniers modifiés, snippets à vérifier avant export, raccourcis.
- Page d'un snippet, menu **⋯** : Dupliquer, Copier le LADDER, Ouvrir le dossier (explorateur), Supprimer.
- **Thème clair / sombre** : bouton soleil / lune en haut de la bibliothèque (mémorisé).

| Raccourci | Action |
|---|---|
| Ctrl+N | Nouveau snippet |
| Ctrl+F | Rechercher dans la bibliothèque |
| Ctrl+S | Enregistrer (éditeur) |
| Ctrl+D | Dupliquer le snippet ouvert |
| Ctrl+Z / Ctrl+Y | Annuler / rétablir dans l'éditeur LADDER (100 étapes) |
| Ctrl+P | Imprimer le snippet ouvert (ou PDF) |
| Suppr / Échap | Effacer / désélectionner dans le schéma LADDER |

## Ordre des snippets

Glisser la poignée ⋮⋮ (à gauche d'un snippet, au survol) vers le haut ou le bas.
L'ordre est enregistré dans `library.json` à la racine de la bibliothèque (synchronisé avec elle).
Les nouveaux snippets arrivent à la fin, triés par titre. Le glisser est désactivé pendant une recherche.
