# Nouveautés

Chaque version publiée a sa section `## vX.Y.Z`. Le workflow « Publier une version » en reprend le
texte pour la release GitHub et pour la notification de mise à jour dans l'application.

## v0.3.4

- Export SimaticML (LADDER) validé dans TIA V20 : il n'est plus marqué expérimental.
- Numéro de version et de build affichés à côté du nom de l'application.
- Les messages d'export reviennent à la ligne par mots entiers au lieu de couper un mot en deux.

## v0.3.3

- Test de la mise à jour automatique.
- Export LIST (.awl) vers TIA corrigé : les parenthèses « U( » / « A( » sont maintenant terminées
  par « ; » comme TIA l'exige (la génération du bloc échouait).
- Choix de la mnémonique (allemande ou internationale) dans « Exporter ▾ » et dans le panneau
  d'export, mémorisé d'une fois sur l'autre. Elle doit correspondre au réglage de TIA.
- L'export liste les variables API / DB à créer dans TIA avant d'importer le bloc.

## v0.3.2

- Première version installable de la mise à jour automatique. À installer à la main une fois : les versions suivantes seront proposées directement dans l'application.

## v0.2.0

- Import / export SimaticML du LADDER avec TIA Portal (export réglé pour la V20, expérimental).

## v0.1.0

- Première version : bibliothèque de snippets LADDER / SCL / LIST, éditeur LADDER visuel,
  import / export zip et sources TIA .scl / .awl.
