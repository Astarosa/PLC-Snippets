import { emptyForm, emptyInterface, type SnippetForm, suggestId } from "./form";
import type { BlockType, PlcTag, SnippetInterface } from "./schema";

/**
 * Modèles proposés à la création d'un snippet : des montages courants, prêts à adapter
 * (noms et adresses à remplacer par ceux de l'installation).
 */
export interface SnippetTemplate {
  id: string;
  label: string;
  description: string;
  build: () => SnippetForm;
}

interface TemplateSpec {
  title: string;
  summary: string;
  tags: string[];
  blockType: BlockType;
  lad: string;
  plcTags?: PlcTag[];
  iface?: Partial<SnippetInterface>;
  readme?: string;
}

function fromSpec(spec: TemplateSpec): SnippetForm {
  const base = emptyForm();
  return {
    ...base,
    id: suggestId(spec.title),
    title: spec.title,
    summary: spec.summary,
    tagsText: spec.tags.join(", "),
    blockType: spec.blockType,
    // Copies : un snippet créé ne doit pas modifier le modèle.
    interface: structuredClone({ ...emptyInterface(), ...spec.iface }),
    plcTags: structuredClone(spec.plcTags ?? []),
    lad: { ...base.lad, content: `${spec.lad.trim()}\n` },
    scl: { ...base.scl, generated: true },
    readme: spec.readme ?? "",
  };
}

const tag = (name: string, type: string, address: string, comment: string): PlcTag => ({
  name,
  type,
  address,
  comment,
});

const SPECS: (TemplateSpec & { id: string; label: string; description: string })[] = [
  {
    id: "marche-arret",
    label: "Marche / arrêt avec auto-maintien",
    description: "Démarrage moteur : BP marche, BP arrêt câblé NF, relais thermique.",
    title: "Marche / arrêt moteur avec auto-maintien",
    summary: "Démarrage par BP marche, auto-maintien par le contacteur, arrêt et thermique câblés NF.",
    tags: ["moteur", "auto-maintien"],
    blockType: "NETWORK",
    lad: `
network "Commande moteur"
  // BP arrêt et relais thermique câblés NF : à 1 au repos, la rupture de fil arrête le moteur.
  ( NO "BP_Marche" | NO "KM_Moteur" ) & NO "BP_Arret" & NO "RT_Moteur" -> COIL "KM_Moteur"
`,
    plcTags: [
      tag("BP_Marche", "Bool", "%I0.0", "Bouton marche (NO)"),
      tag("BP_Arret", "Bool", "%I0.1", "Bouton arrêt (câblé NF)"),
      tag("RT_Moteur", "Bool", "%I0.2", "Relais thermique (câblé NF, 1 = OK)"),
      tag("KM_Moteur", "Bool", "%Q0.0", "Contacteur moteur"),
    ],
  },
  {
    id: "tempo",
    label: "Temporisation à l'enclenchement",
    description: "Filtre un capteur : la sortie suit l'entrée après un délai (TON).",
    title: "Capteur filtré par temporisation",
    summary: "La sortie passe à 1 quand le capteur est présent depuis 3 s (TON).",
    tags: ["tempo", "filtrage"],
    blockType: "NETWORK",
    lad: `
network "Filtrage capteur"
  NO "Capteur" & TON "T_Capteur" PT=T#3S -> COIL "Capteur_Stable"
`,
    plcTags: [
      tag("Capteur", "Bool", "%I0.3", "Capteur brut"),
      tag("Capteur_Stable", "Bool", "%M10.0", "Capteur présent depuis 3 s"),
    ],
    readme: "Le DB d'instance « T_Capteur » est créé par TIA à l'import du réseau.",
  },
  {
    id: "alarme",
    label: "Alarme avec acquittement",
    description: "Mémorise un défaut (SET), acquittement une fois le défaut disparu (RESET).",
    title: "Alarme mémorisée avec acquittement",
    summary:
      "Un défaut fugitif reste signalé jusqu'à l'acquittement, accepté seulement quand le défaut a disparu.",
    tags: ["alarme", "défaut"],
    blockType: "NETWORK",
    lad: `
network "Mémorisation du défaut"
  NO "Defaut" -> SET "Alarme"
  NO "BP_Acquit" & NC "Defaut" -> RESET "Alarme"

network "Signalisation"
  NO "Alarme" -> COIL "Voyant_Defaut"
`,
    plcTags: [
      tag("Defaut", "Bool", "%I0.4", "Défaut instantané"),
      tag("BP_Acquit", "Bool", "%I0.5", "Bouton acquittement"),
      tag("Alarme", "Bool", "%M10.1", "Défaut mémorisé"),
      tag("Voyant_Defaut", "Bool", "%Q0.1", "Voyant défaut"),
    ],
  },
  {
    id: "comptage",
    label: "Comptage sur front montant",
    description: "Compte les passages d'un capteur (front P + CTU), lot complet à 100.",
    title: "Comptage de pièces par lot",
    summary: "Chaque front montant du capteur compte une pièce ; la sortie signale un lot de 100 pièces.",
    tags: ["comptage", "front"],
    blockType: "NETWORK",
    lad: `
network "Comptage"
  P "Capteur_Piece" MEM="M_Front_Piece" & CTU "C_Pieces" R="BP_Raz" PV=100 CV="Nb_Pieces" -> COIL "Lot_Complet"
`,
    plcTags: [
      tag("Capteur_Piece", "Bool", "%I0.6", "Détection pièce"),
      tag("M_Front_Piece", "Bool", "%M10.2", "Mémoire du front montant"),
      tag("BP_Raz", "Bool", "%I0.7", "Remise à zéro du compteur"),
      tag("Nb_Pieces", "Int", "%MW20", "Pièces comptées"),
      tag("Lot_Complet", "Bool", "%Q0.2", "Lot de 100 pièces"),
    ],
  },
  {
    id: "seuils",
    label: "Seuils sur une mesure",
    description: "Niveau haut / bas d'une entrée analogique avec deux comparateurs.",
    title: "Seuils haut et bas d'un niveau",
    summary: "Deux comparateurs sur une mesure : niveau haut à partir de 80, niveau bas en dessous de 20.",
    tags: ["analogique", "comparaison"],
    blockType: "NETWORK",
    lad: `
network "Seuils"
  CMP "Niveau" >= 80 -> COIL "Niveau_Haut"
  CMP "Niveau" <= 20 -> COIL "Niveau_Bas"
`,
    plcTags: [
      tag("Niveau", "Int", "%MW30", "Niveau mis à l'échelle (0-100)"),
      tag("Niveau_Haut", "Bool", "%M10.3", "Niveau ≥ 80"),
      tag("Niveau_Bas", "Bool", "%M10.4", "Niveau ≤ 20"),
    ],
  },
  {
    id: "fb-moteur",
    label: "FB moteur réutilisable",
    description: "Bloc fonctionnel : marche / arrêt / thermique en entrées, commande et défaut en sorties.",
    title: "FB commande moteur",
    summary: "Marche / arrêt avec auto-maintien et défaut thermique, à appeler une fois par moteur.",
    tags: ["moteur", "FB"],
    blockType: "FB",
    lad: `
network "Commande"
  ( NO #Marche | NO #Commande ) & NO #Arret & NO #Thermique -> COIL #Commande

network "Défaut"
  NC #Thermique -> COIL #Defaut
`,
    iface: {
      input: [
        { name: "Marche", type: "Bool", comment: "Ordre de marche" },
        { name: "Arret", type: "Bool", comment: "Arrêt (1 = autorisé, câblé NF)" },
        { name: "Thermique", type: "Bool", comment: "Relais thermique (1 = OK)" },
      ],
      output: [
        { name: "Commande", type: "Bool", comment: "Commande du contacteur" },
        { name: "Defaut", type: "Bool", comment: "Défaut thermique" },
      ],
    },
  },
];

export const BLANK_TEMPLATE: SnippetTemplate = {
  id: "vide",
  label: "Snippet vide",
  description: "Partir de zéro.",
  build: emptyForm,
};

export const TEMPLATES: SnippetTemplate[] = [
  BLANK_TEMPLATE,
  ...SPECS.map(({ id, label, description, ...spec }) => ({
    id,
    label,
    description,
    build: () => fromSpec(spec),
  })),
];
