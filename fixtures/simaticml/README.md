# Fixtures SimaticML (LAD)

## `synthetic-v17/` — exemples SYNTHÉTIQUES

Écrits à la main d'après la structure des exports Openness (cible TIA V17 : Interface `v5`,
FlgNet `v4`). **Ce ne sont pas des exports TIA réels** : ils servent à développer et tester le
parseur, pas à prouver la compatibilité avec TIA.

| Fichier | Cas |
|---|---|
| `01_contacts.xml` | NO + NC en série, branche parallèle (`Part O`) |
| `02_bobines.xml` | `Coil`, `SCoil`, `RCoil`, deux bobines sur un rung |
| `03_fronts.xml` | `PContact` / `NContact` avec bit mémoire |
| `04a_ton_db_instance.xml` | TON en DB d'instance, PT constante, ET non câblé (`OpenCon`) |
| `04b_ton_multiinstance.xml` | TON multi-instance, PT et ET câblés |
| `04c_ctu.xml` | CTU multi-instance, R, PV, CV |
| `05_boites.xml` | `Move`, `Add`, `Ge`, `Eq` avec constantes littérales |
| `06_reseau_commente.xml` | titres, commentaires multi-lignes, valeurs initiales, constante |

## `real-v20/` — exports TIA RÉELS

Exportés depuis TIA Portal V20 par Baptiste. **Ne jamais modifier un fichier réel une fois déposé.**

| Fichier | Cas |
|---|---|
| `Block_2.xml` | FC, OU de deux contacts globaux (`"BPM"`, `"KM1"`) vers une bobine, 2ᵉ réseau vide |

Ce qu'il a appris : en V20, FlgNet est en `v5` (pas `v4`), le bloc porte `<Namespace />`, les textes
sont en `en-US`, TIA déclare les Access avant les Part et numérote les UId à partir de 21 par réseau,
et un réseau vide a un `<NetworkSource />` vide. L'export de l'app suit ces règles (cible V20 par défaut).

## Ajouter d'autres exports réels

Déposer l'export brut de TIA dans `real-vNN/` (NN = version de TIA) et ajouter un test qui vérifie
le LADDER attendu. Un fichier par cas : contacts, fronts, TON / CTU, MOVE / ADD, comparateurs…
