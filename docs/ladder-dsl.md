# Le DSL LADDER

> Tu peux aussi construire le schéma à la souris dans l'onglet **Visuel** de l'éditeur :
> il écrit ce même texte pour toi (voir le README).

Le LADDER s'écrit en texte, l'app le dessine et peut en générer le SCL équivalent.
Un **rung** (une ligne de schéma) = une condition faite de contacts, puis `->`, puis une ou plusieurs bobines.

```
network "Marche / arrêt avec auto-maintien"
  ( NO "BP_Marche" | NO "KM1" ) & NO "BP_Arret" & NC "Defaut" -> COIL "KM1"
```

## Éléments

| Écriture | Symbole | Rôle | SCL généré |
|---|---|---|---|
| `NO "A"` | `─┤ ├─` | contact normalement ouvert | `"A"` |
| `NC "A"` | `─┤/├─` | contact normalement fermé | `NOT "A"` |
| `COIL "X"` | `─( )` | bobine | `"X" := …;` |
| `NCOIL "X"` | `─(/)` | bobine inversée | `"X" := NOT (…);` |
| `SET "X"` | `─(S)` | mise à 1 | `IF … THEN "X" := TRUE; END_IF;` |
| `RESET "X"` | `─(R)` | mise à 0 | `IF … THEN "X" := FALSE; END_IF;` |

## Assemblage

| Écriture | Signification |
|---|---|
| `a & b` | en **série** (ET) |
| `a \| b` | en **parallèle** (OU) |
| `( … )` | groupe, comme en maths : `&` est prioritaire sur `\|` |
| `-> COIL "X", SET "Y"` | plusieurs bobines en parallèle sur le même rung |

`NO "A" & NO "B" | NO "C"` se lit `(A ET B) OU C`. Pour `A ET (B OU C)`, il faut les parenthèses :
`NO "A" & ( NO "B" | NO "C" )`.

## Opérandes

- Variable API (mnémonique) : `"BP_Marche"`, membre de DB : `"DB_Ligne".Marche` ou `"DB"."Mot clé"`
- Variable locale du bloc : `#Capteur`, membre d'instance : `#Tempo.Q`
- Adresse absolue : `%I0.0`, `%Q4.1`, `%M10.0`

## Réseaux, lignes, commentaires

- `network "Titre"` commence un nouveau réseau (le titre est optionnel). Le mot-clé peut être omis pour le premier.
- Un réseau peut contenir plusieurs rungs, l'un sous l'autre.
- Les retours à la ligne sont libres ; `//` commente jusqu'à la fin de la ligne.
- Un commentaire placé **avant `network`** (ou sur sa ligne) appartient au réseau ; placé **avant un rung
  ou sur ses lignes**, il appartient au rung. Il est affiché sur le schéma, conservé par l'éditeur visuel
  et repris dans le SCL généré.
- Les mots-clés ne sont pas sensibles à la casse (`no`, `NO`, `No`).

## Génération du SCL

Avec « Générer le SCL automatiquement », le SCL est recalculé à chaque enregistrement et marqué *(généré)*.

- Un rung à une seule bobine devient une affectation : `"KM1" := ("BP_Marche" OR "KM1") AND "BP_Arret";`
- Avec plusieurs bobines ou des SET/RESET, la condition passe dans un `IF … ELSE … END_IF` :
  elle n'est évaluée qu'une fois, comme en LADDER, même si une bobine modifie un contact du rung.

## Fronts et comparateurs

S'utilisent comme des contacts, en série ou en parallèle.

| Écriture | Rôle | SCL généré |
|---|---|---|
| `P "Bp" MEM="M_Bp"` | front montant, avec son bit mémoire | `"Bp" AND NOT "M_Bp"`, puis `"M_Bp" := "Bp";` après le rung |
| `N "Bp" MEM="M_Bp"` | front descendant | `NOT "Bp" AND "M_Bp"`, puis `"M_Bp" := "Bp";` |
| `CMP "Niveau" >= 80` | comparateur (`==`, `<>`, `>`, `<`, `>=`, `<=`) | `"Niveau" >= 80` |

Le bit mémoire d'un front doit être **dédié** : ne l'utilise nulle part ailleurs (comme dans TIA Portal).

## Boîtes

Une boîte reçoit le fil sur sa broche d'entrée et le fait continuer par sa broche de sortie :
on peut donc mettre des contacts après, ou finir le rung directement sur la boîte (sans `->`).
Les paramètres s'écrivent `NOM=valeur`, dans n'importe quel ordre.

### Temporisations et compteurs

L'instance suit le mot-clé : `"T_Defaut"` pour un DB d'instance, `#Tempo` en multi-instance (Static d'un FB).

| Boîte | Entrée du fil → sortie | Paramètres (obligatoires en gras) |
|---|---|---|
| `TON`, `TOF`, `TP` | IN → Q | **PT**, ET |
| `TONR` | IN → Q | **PT**, R, ET |
| `CTU` | CU → Q | **PV**, R, CV |
| `CTD` | CD → Q | **PV**, LD, CV |
| `CTUD` | CU → QU | **PV**, CD, R, LD, QD, CV |

```
NO "Capteur" & NC "Raz" & TON #Tempo PT=T#5S ET=#Ecoule -> COIL "Defaut"
```
devient
```
#Tempo(IN := "Capteur" AND NOT "Raz", PT := T#5S, ET => #Ecoule);
"Defaut" := #Tempo.Q;
```
Avec un DB d'instance, l'appel s'écrit `"T_Defaut".TON(IN := …, PT := …);`.

### Transfert et calculs

| Boîte | Paramètres | SCL généré |
|---|---|---|
| `MOVE` | **IN**, **OUT** | `OUT := IN;` |
| `ADD`, `SUB`, `MUL`, `DIV` | **IN1**, **IN2**, **OUT** | `OUT := IN1 + IN2;` (−, *, /) |

Ces boîtes s'exécutent si leur entrée EN est vraie : `IF <condition> THEN … END_IF;`.
Placées directement sur la barre, elles s'exécutent à chaque cycle, sans IF.

```
P "Bp" MEM="M_Bp" & MOVE IN=1500 OUT="Consigne"
```

### Valeurs

Opérandes (`"Mnémo"`, `#Locale`, `%MW10`) ou constantes : `T#5S`, `T#1M30S`, `16#FF`, `INT#10`, `10`, `2.5`, `TRUE`, `FALSE`.
Les sorties (ET, CV, OUT…) doivent être des variables.

## Génération du LIST

Comme TIA quand il traduit du CONT en LIST : `U` en série, `U(` … `O` … `)` pour les branches, `CALL`
pour les temporisations et compteurs (le RLO entrant est écrit sur leur entrée), `SPBNB` pour MOVE et
calculs. Une **boîte dans une branche parallèle** est exécutée avant la logique du rung, avec les contacts
qui la précèdent sur son chemin ; dans la logique, une temporisation / un compteur devient un contact sur
sa sortie (`O "T".Q`), un MOVE / calcul laisse passer le courant. Ce n'est pas possible si un front ou une
autre boîte la précède sur ce chemin : il faut alors séparer en deux rungs.

## Limites connues

- Pas de gestion de l'erreur de calcul : ENO recopie EN (pas de débordement ni de division par zéro signalés).
- Le schéma coupe les noms longs (le nom complet s'affiche au survol).
