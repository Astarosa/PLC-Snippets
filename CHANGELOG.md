# Nouveautés

Chaque version publiée a sa section `## vX.Y.Z`. Le workflow « Publier une version » en reprend le
texte pour la release GitHub et pour la notification de mise à jour dans l'application.

## v0.5.0

- Nouvelle interface. L'éditeur a deux zones : le programme à gauche (onglets LADDER / SCL / LIST,
  palette en barre d'outils) et un panneau à droite (élément sélectionné, interface, variables API,
  problèmes). La barre du haut reste visible avec les infos du snippet, l'état des contrôles et
  « Enregistrer ». La bibliothèque se replie pendant l'édition.
- Thème clair, en plus du thème sombre (bouton soleil / lune, mémorisé).
- Bibliothèque : filtres par type de bloc, langage et tag ; ⛔ sur les snippets dont le LADDER
  bloquerait l'export. Accueil avec les derniers modifiés et les snippets à vérifier avant export.
- Page d'un snippet : « Dupliquer », « Ouvrir le dossier » et les autres actions secondaires dans un
  menu ⋯, tags cliquables pour filtrer la bibliothèque, interface et variables API côte à côte.
- Raccourcis clavier : Ctrl+N (nouveau), Ctrl+F (rechercher), Ctrl+S (enregistrer), Ctrl+D (dupliquer).
- Retour à l'accueil : titre « PLC Snippets » et icône maison, aussi dans la bibliothèque repliée.
- Génération du LIST (STL / AWL) depuis le LADDER, comme pour le SCL : case « Générer le LIST
  automatiquement », dans la mnémonique choisie (allemand ou anglais). Contacts, branches, bobines,
  fronts, comparateurs, MOVE / calculs et appels de temporisations / compteurs. Les types des
  comparaisons et calculs (I / D / R) viennent de l'interface et des variables API ; un type inconnu
  est signalé. Une boîte dans une branche parallèle n'est pas encore traduite (message clair).
- Export « Source externe LIST (.awl) » possible pour un snippet qui n'a que du LADDER : le LIST est
  généré à l'export, avec un réseau TIA par réseau LADDER.

## v0.4.0

- Détection des erreurs dans le LADDER avant l'export vers TIA. Les erreurs (opérande « ??? »,
  instance manquante, variable locale non déclarée, type incompatible, DB d'instance qui porte le
  nom d'une variable API…) sont entourées en rouge et bloquent l'export SimaticML et SCL. Les
  avertissements (double affectation, Set sans Reset, bit de front en Temp…) sont en orange et
  n'empêchent pas l'export.
- La liste des problèmes s'affiche au-dessus des réseaux : un clic sélectionne l'élément en cause.
- La palette des symboles reste visible au défilement, comme le bandeau des propriétés.
- Table des variables API (PLC tags) dans chaque snippet : nom, type, adresse, commentaire. On la
  remplit à la main, ou depuis le LADDER : en sélectionnant un élément (« Déclarer »), ou d'un clic
  avec « Tout déclarer » (le type est déduit de l'usage : Bool, Time, Int…).
- Nouvel export « Table des variables API (.xlsx) » au format Excel de TIA, à importer dans une table
  des variables API. Adresses écrites dans la mnémonique du projet (%I / %E), adresses manquantes
  attribuées en %M à partir de %MB1000.
- Contrôles des variables API : adresse invalide ou de mauvaise taille, chevauchements, type qui ne
  correspond pas à l'usage dans le LADDER, instance de tempo déclarée comme variable.
- Format des snippets v2 (champ `plcTags`) : les anciens snippets sont migrés à la lecture.

## v0.3.4

- Export SimaticML (LADDER) validé dans TIA V20 : il n'est plus marqué expérimental.
- Numéro de version et de build affichés à côté du nom de l'application.
- Les messages d'export reviennent à la ligne par mots entiers au lieu de couper un mot en deux.
- Accents corrects dans TIA : les sources .scl / .awl exportées sont enregistrées en UTF-8 avec BOM
  (TIA affichait « RÃ©seau » au lieu de « Réseau »). Une source TIA en encodage Windows est
  maintenant lue à l'import au lieu d'être ignorée.

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
