import { invoke } from "@tauri-apps/api/core";
import { parseRawSnippet, type RawSnippet } from "../core/snippet/parse";
import type { InvalidSnippet, Snippet } from "../core/snippet/schema";
import type { LibraryContent, SnippetRepository } from "./repository";

/** Implémentation disque, via les commandes Rust de `src-tauri/src/lib.rs`. */
export const tauriRepository: SnippetRepository = {
  async list(library) {
    const raws = await invoke<RawSnippet[]>("list_snippets", { library });
    const content: LibraryContent = { snippets: [] as Snippet[], invalid: [] as InvalidSnippet[] };
    for (const raw of raws) {
      const result = parseRawSnippet(raw);
      if (result.ok) content.snippets.push(result.snippet);
      else content.invalid.push(result.invalid);
    }
    content.snippets.sort((a, b) => a.meta.title.localeCompare(b.meta.title, "fr"));
    return content;
  },

  async create(library, snippet) {
    await invoke("create_snippet", { library, snippet });
  },

  async write(library, snippet) {
    await invoke("write_snippet", { library, snippet });
  },

  async delete(library, id) {
    await invoke("delete_snippet", { library, id });
  },
};
