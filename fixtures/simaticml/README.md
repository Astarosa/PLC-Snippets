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

## `real-vNN/` — exports TIA réels (à venir)

Pour figer de vraies fixtures : importer chaque fichier synthétique dans un projet TIA (Openness),
compiler, ré-exporter, et déposer l'export de TIA dans `real-v17/` (ou la version utilisée).
Les tests les liront automatiquement. Ne jamais modifier un fichier réel une fois déposé.
