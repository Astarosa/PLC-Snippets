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
  /** Crée un snippet ; échoue si l'identifiant existe déjà. */
  create(library: string, snippet: RawSnippet): Promise<void>;
  /** Remplace un snippet existant. */
  write(library: string, snippet: RawSnippet): Promise<void>;
  delete(library: string, id: string): Promise<void>;
  /** Enregistre l'ordre d'affichage (identifiants). */
  writeOrder(library: string, order: string[]): Promise<void>;
}
