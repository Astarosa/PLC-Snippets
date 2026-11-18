import { parseLadder } from "../core/ladder/parse";
import { ladderToScl } from "../core/ladder/scl";
import { type RawSnippet, toRawSnippet } from "../core/snippet/parse";

const SURVEILLANCE_LAD = `network "Défaut de bourrage"
  NO "Convoyeur_Marche" & NC "Capteur_Sortie" & TON "T_Bourrage" PT=T#8S -> SET "Defaut_Bourrage"
  NO "Acquit" -> RESET "Defaut_Bourrage"

network "Comptage des pièces"
  P "Capteur_Sortie" MEM="M_Front_Sortie" & CTU "C_Lot" R="Raz_Lot" PV=50 CV="Nb_Pieces" -> COIL "Lot_Complet"
`;

/** Le SCL de l'exemple est généré par l'app elle-même : il reste toujours cohérent. */
function generated(lad: string): string {
  const parsed = parseLadder(lad);
  if (!parsed.ok) throw new Error(`Exemple LADDER invalide : ${parsed.error.message}`);
  return ladderToScl(parsed.program);
}

/** Snippets d'exemple, écrits dans une bibliothèque vide pour tester l'app. */
export function sampleSnippets(now = new Date().toISOString()): RawSnippet[] {
  return [
    toRawSnippet({
      id: "marche-arret-auto-maintien",
      meta: {
        schemaVersion: 1,
        title: "Marche / arrêt avec auto-maintien",
        summary: "Commande moteur classique : BP marche, BP arrêt câblé NF, coupure sur défaut.",
        tags: ["moteur", "base", "auto-maintien"],
        blockType: "NETWORK",
        cpuFamilies: ["S7-1200", "S7-1500"],
        tiaVersion: "V19",
        variants: [
          { lang: "LAD", file: "main.lad" },
          { lang: "SCL", file: "main.scl", generated: false },
        ],
        createdAt: now,
        updatedAt: now,
      },
      readme: [
        "# Marche / arrêt avec auto-maintien",
        "",
        "- `BP_Arret` est câblé **NF** : la variable vaut TRUE quand le bouton n'est pas appuyé,",
        "  d'où un contact **NO** dans le programme (sécurité positive : un fil coupé arrête le moteur).",
        "- `Defaut` regroupe les défauts (relais thermique, arrêt d'urgence via relais de sécurité…).",
      ].join("\n"),
      files: {
        "main.lad": [
          'network "Marche / arrêt avec auto-maintien"',
          '  ( NO "BP_Marche" | NO "KM1" ) & NO "BP_Arret" & NC "Defaut" -> COIL "KM1"',
          "",
        ].join("\n"),
        "main.scl": [
          "// BP_Arret câblé NF : TRUE = bouton non appuyé",
          '"KM1" := ("BP_Marche" OR "KM1") AND "BP_Arret" AND NOT "Defaut";',
          "",
        ].join("\n"),
      },
    }),
    toRawSnippet({
      id: "surveillance-bourrage-comptage",
      meta: {
        schemaVersion: 1,
        title: "Surveillance de bourrage et comptage par lot",
        summary:
          "Défaut si la sortie reste libre 8 s convoyeur en marche ; comptage des pièces sur front montant.",
        tags: ["convoyeur", "TON", "CTU", "front", "défaut"],
        blockType: "NETWORK",
        cpuFamilies: ["S7-1200", "S7-1500"],
        tiaVersion: "V19",
        variants: [
          { lang: "LAD", file: "main.lad" },
          { lang: "SCL", file: "main.scl", generated: true },
        ],
        createdAt: now,
        updatedAt: now,
      },
      readme: [
        "# Surveillance de bourrage et comptage",
        "",
        "- `T_Bourrage` et `C_Lot` sont des DB d'instance (IEC_TIMER / IEC_COUNTER).",
        "- Le défaut est mémorisé (SET) et ne retombe qu'à l'acquittement.",
        "- `M_Front_Sortie` est le bit mémoire du front montant : un bit dédié, utilisé nulle part ailleurs.",
      ].join("\n"),
      files: { "main.lad": SURVEILLANCE_LAD, "main.scl": generated(SURVEILLANCE_LAD) },
    }),
    toRawSnippet({
      id: "machine-etat-convoyeur",
      meta: {
        schemaVersion: 1,
        title: "Machine d'état convoyeur avec surveillance de transfert",
        summary:
          "FB : attente → transfert → défaut si la pièce n'arrive pas en sortie dans le temps imparti.",
        tags: ["convoyeur", "machine d'état", "CASE", "TON"],
        blockType: "FB",
        cpuFamilies: ["S7-1200", "S7-1500"],
        tiaVersion: "V19",
        interface: {
          input: [
            { name: "Marche", type: "Bool", comment: "Ordre de marche" },
            { name: "Arret", type: "Bool", comment: "BP arrêt câblé NF (TRUE = non appuyé)" },
            { name: "CapteurEntree", type: "Bool", comment: "Pièce présente en entrée" },
            { name: "CapteurSortie", type: "Bool", comment: "Pièce arrivée en sortie" },
            { name: "Acquit", type: "Bool", comment: "Acquittement défaut" },
            { name: "TempsMaxTransfert", type: "Time", initial: "T#10S" },
          ],
          output: [
            { name: "Moteur", type: "Bool" },
            { name: "Defaut", type: "Bool" },
            { name: "Etape", type: "Int", comment: "Étape courante (diagnostic IHM)" },
          ],
          static: [{ name: "TempoTransfert", type: "TON_TIME" }],
          constant: [
            { name: "ST_ATTENTE", type: "Int", initial: "0" },
            { name: "ST_TRANSFERT", type: "Int", initial: "10" },
            { name: "ST_DEFAUT", type: "Int", initial: "90" },
          ],
        },
        variants: [{ lang: "SCL", file: "main.scl" }],
        createdAt: now,
        updatedAt: now,
      },
      readme:
        "# Machine d'état convoyeur\n\nPas d'équivalent LADDER lisible : un `CASE` sur des constantes d'étape.\nLes étapes sont espacées (0, 10, 90) pour pouvoir en insérer plus tard.\n",
      files: {
        "main.scl": `// Surveillance : la pièce doit atteindre la sortie avant TempsMaxTransfert
#TempoTransfert(IN := (#Etape = #ST_TRANSFERT) AND NOT #CapteurSortie,
                PT := #TempsMaxTransfert);

CASE #Etape OF
    #ST_ATTENTE:
        #Moteur := FALSE;
        IF #Marche AND #Arret AND #CapteurEntree THEN
            #Etape := #ST_TRANSFERT;
        END_IF;

    #ST_TRANSFERT:
        #Moteur := TRUE;
        IF NOT #Arret OR #CapteurSortie THEN
            #Etape := #ST_ATTENTE;
        ELSIF #TempoTransfert.Q THEN
            #Etape := #ST_DEFAUT;
        END_IF;

    #ST_DEFAUT:
        #Moteur := FALSE;
        IF #Acquit THEN
            #Etape := #ST_ATTENTE;
        END_IF;

    ELSE
        #Etape := #ST_ATTENTE;
END_CASE;

#Defaut := (#Etape = #ST_DEFAUT);
`,
      },
    }),
  ];
}
