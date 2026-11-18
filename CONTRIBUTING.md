# Contribuer à PLC Snippets

## Avant chaque commit

```bash
npm run check      # Biome (lint + format) + types
npm test           # tests TypeScript
npm run test:rust  # tests Rust
```

La CI (GitHub Actions) refait tout ça sur Windows et ne produit le .exe que si tout passe.

## Faire évoluer le format des snippets

Le format est versionné : chaque `snippet.json` porte `"schemaVersion"`. Il change dès qu'on modifie :

- un champ de `snippet.json` (ajout, renommage, suppression, changement de sens) ;
- la syntaxe d'un fichier de code (`.lad`, `.scl`, `.awl`) telle que l'app l'écrit ou la lit.

Dans ce cas, **trois étapes obligatoires**, dans cet ordre :

1. **Figer l'ancien format** : copier des snippets représentatifs de la version actuelle N dans
   `fixtures/vN/` s'ils n'y sont pas déjà. Ne jamais modifier les fixtures existantes.
2. **Écrire la migration** dans `src/core/snippet/migrate.ts` : `MIGRATIONS[N]` transforme un snippet
   de la version N en version N + 1 (snippet.json **et** fichiers si besoin) et met
   `schemaVersion` à N + 1. Puis passer `CURRENT_VERSION` à N + 1.
3. **Adapter le schéma** (`src/core/snippet/schema.ts`) et le code qui écrit les snippets.

Le test `src/core/snippet/fixtures.test.ts` migre toutes les fixtures jusqu'au format courant :
s'il échoue, la migration est incomplète.

Comportement de l'application :

- un snippet plus ancien est migré à la lecture (bibliothèque et import), puis réécrit au format
  courant au prochain enregistrement ;
- un snippet plus récent que l'application est refusé avec un message demandant de la mettre à jour.

## Ajouter un format d'import / export

Les formats sont des adaptateurs (`src/core/io/`). Un adaptateur déclare son nom, sa famille
(menu Exporter ▾), s'il est complet ou avec perte, et implémente `detect` / `import` et/ou `export`.
L'interface se construit à partir du registre : il n'y a rien d'autre à modifier.
