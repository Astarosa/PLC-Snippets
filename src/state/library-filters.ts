import { create } from "zustand";
import { type LibraryFilters, NO_FILTERS } from "../core/snippet/filter";
import type { BlockType, Lang } from "../core/snippet/schema";

const toggle = <T>(list: T[], value: T) =>
  list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

interface FiltersState extends LibraryFilters {
  /** Incrémenté à chaque demande de focus de la recherche (Ctrl+F) : déplie la bibliothèque. */
  searchFocus: number;
  /** Demande de focus pas encore servie (le champ peut ne pas être affiché à cet instant). */
  searchFocusPending: boolean;
  setQuery: (query: string) => void;
  toggleBlockType: (b: BlockType) => void;
  toggleLang: (l: Lang) => void;
  toggleTag: (tag: string) => void;
  /** Filtre sur un seul tag (clic sur un tag d'une page de snippet). */
  showTag: (tag: string) => void;
  clear: () => void;
  focusSearch: () => void;
  searchFocused: () => void;
}

/** Filtres de la bibliothèque, partagés entre la barre latérale, la page d'un snippet et les raccourcis. */
export const useLibraryFilters = create<FiltersState>((set) => ({
  ...NO_FILTERS,
  searchFocus: 0,
  searchFocusPending: false,
  setQuery: (query) => set({ query }),
  toggleBlockType: (b) => set((s) => ({ blockTypes: toggle(s.blockTypes, b) })),
  toggleLang: (l) => set((s) => ({ langs: toggle(s.langs, l) })),
  toggleTag: (tag) => set((s) => ({ tags: toggle(s.tags, tag) })),
  showTag: (tag) => set({ ...NO_FILTERS, tags: [tag] }),
  clear: () => set({ ...NO_FILTERS }),
  focusSearch: () => set((s) => ({ searchFocus: s.searchFocus + 1, searchFocusPending: true })),
  searchFocused: () => set({ searchFocusPending: false }),
}));
