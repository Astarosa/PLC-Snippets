import { create } from "zustand";
import { defaultChoice, type ItemChoice } from "../core/io/apply";
import { previewImport } from "../core/io/registry";
import type { ImportPreview } from "../core/io/types";
import { readImportSource } from "../storage/transfer";

interface ImportState {
  loading: boolean;
  error: string | null;
  preview: ImportPreview | null;
  choices: ItemChoice[];
  /** Lit la source (zip, dossier, fichier) et ouvre l'aperçu. */
  open: (path: string) => Promise<void>;
  setChoice: (index: number, choice: Partial<ItemChoice>) => void;
  close: () => void;
}

export const useImport = create<ImportState>((set) => ({
  loading: false,
  error: null,
  preview: null,
  choices: [],

  async open(path) {
    set({ loading: true, error: null, preview: null, choices: [] });
    try {
      const preview = previewImport(await readImportSource(path));
      set({ loading: false, preview, choices: preview.items.map(defaultChoice) });
    } catch (e) {
      set({ loading: false, error: String(e) });
    }
  },

  setChoice(index, choice) {
    set((s) => ({ choices: s.choices.map((c, i) => (i === index ? { ...c, ...choice } : c)) }));
  },

  close: () => set({ loading: false, error: null, preview: null, choices: [] }),
}));
