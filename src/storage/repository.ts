import type { RawSnippet } from "../core/snippet/parse";
import type { InvalidSnippet, Snippet } from "../core/snippet/schema";

export interface LibraryContent {
  snippets: Snippet[];
  invalid: InvalidSnippet[];
}

/**
 * Contrat d'accès à une bibliothèque. L'interface ne dépend que de ceci :
 * une future version web (serveur sur le NAS) n'aura qu'à fournir
 * une autre implémentation.
 */
export interface SnippetRepository {
  list(library: string): Promise<LibraryContent>;
  write(library: string, snippet: RawSnippet): Promise<void>;
}
