# Fixtures de format

Un dossier par version du format (`v1/`, `v2/`…), contenant de vrais snippets écrits dans ce format.

**Ne jamais modifier ni supprimer ces fichiers** : ils prouvent que les snippets créés avec une
ancienne version de l'application se lisent toujours. Le test `src/core/snippet/fixtures.test.ts`
les migre jusqu'au format courant et vérifie qu'ils sont valides.

Quand le format change, ajouter un dossier `v<ancienne version>/` *avant* d'écrire la migration
(voir `CONTRIBUTING.md`).
