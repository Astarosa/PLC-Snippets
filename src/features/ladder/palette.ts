import type { PaletteItem } from "../../core/ladder/edit";

export interface PaletteEntry {
  item: PaletteItem;
  label: string;
  /** Petit symbole affiché dans la palette. */
  glyph: string;
  hint: string;
}

export const PALETTE: { title: string; entries: PaletteEntry[] }[] = [
  {
    title: "Contacts",
    entries: [
      {
        item: { kind: "contact", variant: "NO" },
        label: "NO",
        glyph: "─┤ ├─",
        hint: "Contact normalement ouvert",
      },
      {
        item: { kind: "contact", variant: "NC" },
        label: "NC",
        glyph: "─┤/├─",
        hint: "Contact normalement fermé",
      },
      { item: { kind: "edge", variant: "P" }, label: "P", glyph: "─┤P├─", hint: "Front montant" },
      { item: { kind: "edge", variant: "N" }, label: "N", glyph: "─┤N├─", hint: "Front descendant" },
      { item: { kind: "compare" }, label: "CMP", glyph: "─┤==├─", hint: "Comparateur" },
    ],
  },
  {
    title: "Bobines",
    entries: [
      { item: { kind: "coil", variant: "COIL" }, label: "Bobine", glyph: "─( )", hint: "Bobine" },
      { item: { kind: "coil", variant: "NCOIL" }, label: "Inverse", glyph: "─(/)", hint: "Bobine inversée" },
      { item: { kind: "coil", variant: "SET" }, label: "Set", glyph: "─(S)", hint: "Mise à 1" },
      { item: { kind: "coil", variant: "RESET" }, label: "Reset", glyph: "─(R)", hint: "Mise à 0" },
    ],
  },
  {
    title: "Temporisations",
    entries: (["TON", "TOF", "TP", "TONR"] as const).map((box) => ({
      item: { kind: "box", box },
      label: box,
      glyph: "[T]",
      hint: {
        TON: "Retard à la montée",
        TOF: "Retard à la retombée",
        TP: "Impulsion",
        TONR: "Retard mémorisé",
      }[box],
    })),
  },
  {
    title: "Compteurs",
    entries: (["CTU", "CTD", "CTUD"] as const).map((box) => ({
      item: { kind: "box", box },
      label: box,
      glyph: "[C]",
      hint: { CTU: "Comptage", CTD: "Décomptage", CTUD: "Comptage / décomptage" }[box],
    })),
  },
  {
    title: "Transfert et calcul",
    entries: (["MOVE", "ADD", "SUB", "MUL", "DIV"] as const).map((box) => ({
      item: { kind: "box", box },
      label: box,
      glyph: { MOVE: "[→]", ADD: "[+]", SUB: "[−]", MUL: "[×]", DIV: "[÷]" }[box],
      hint: {
        MOVE: "Copie IN dans OUT",
        ADD: "Addition",
        SUB: "Soustraction",
        MUL: "Multiplication",
        DIV: "Division",
      }[box],
    })),
  },
];
