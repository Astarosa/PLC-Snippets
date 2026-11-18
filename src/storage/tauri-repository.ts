import { invoke } from "@tauri-apps/api/core";
import { sortByOrder } from "../core/snippet/order";
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
    const order = await invoke<string[]>("read_order", { library }).catch(() => [] as string[]);
    content.snippets = sortByOrder(content.snippets, order);
    return content;
  },

  async create(library, snippet) {
    await invoke("create_snippet", { library, snippet });
  },

  async write(library, snippet) {
    await invoke("write_snippet", { library, snippet });
  },

  async writeOrder(library, order) {
    await invoke("write_order", { library, order });
  },

  async delete(library, id) {
    await invoke("delete_snippet", { library, id });
  },
};
