import { open } from "@tauri-apps/plugin-dialog";
import { load, type Store } from "@tauri-apps/plugin-store";
import { create } from "zustand";
import type { Mnemonic } from "../core/stl/mnemonics";

const LIBRARY_KEY = "libraryPath";
const STL_MNEMONIC_KEY = "stlMnemonic";
const THEME_KEY = "theme";

export type Theme = "dark" | "light";

/** Applique le thème à la page : les couleurs claires sont dans styles.css ([data-theme="light"]). */
const applyTheme = (theme: Theme) => {
  document.documentElement.dataset.theme = theme;
};
let storePromise: Promise<Store> | null = null;
const getStore = () => {
  storePromise ??= load("settings.json", { autoSave: true, defaults: {} });
  return storePromise;
};

interface SettingsState {
  loaded: boolean;
  libraryPath: string | null;
  /** Dernière mnémonique choisie pour exporter du LIST vers TIA (null : jamais choisie). */
  stlMnemonic: Mnemonic | null;
  /** Thème de l'interface : sombre par défaut. */
  theme: Theme;
  init: () => Promise<void>;
  setTheme: (theme: Theme) => Promise<void>;
  chooseLibrary: () => Promise<void>;
  setStlMnemonic: (m: Mnemonic) => Promise<void>;
}

/** Réglages persistés dans le dossier de données de l'app (settings.json). */
export const useSettings = create<SettingsState>((set) => ({
  loaded: false,
  libraryPath: null,
  stlMnemonic: null,
  theme: "dark",

  async init() {
    const store = await getStore();
    const libraryPath = (await store.get<string>(LIBRARY_KEY)) ?? null;
    const stlMnemonic = (await store.get<Mnemonic>(STL_MNEMONIC_KEY)) ?? null;
    const theme = (await store.get<Theme>(THEME_KEY)) === "light" ? "light" : "dark";
    applyTheme(theme);
    set({ loaded: true, libraryPath, stlMnemonic, theme });
  },

  async setTheme(theme) {
    applyTheme(theme);
    set({ theme });
    const store = await getStore();
    await store.set(THEME_KEY, theme);
  },

  async setStlMnemonic(m) {
    set({ stlMnemonic: m });
    const store = await getStore();
    await store.set(STL_MNEMONIC_KEY, m);
  },

  async chooseLibrary() {
    const dir = await open({ directory: true, title: "Choisir le dossier de la bibliothèque" });
    if (typeof dir !== "string") return;
    const store = await getStore();
    await store.set(LIBRARY_KEY, dir);
    set({ libraryPath: dir });
  },
}));
