import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { RawSnippet } from "../core/snippet/parse";
import { useSettings } from "../state/settings";
import { sampleSnippets } from "./sample-library";
import { tauriRepository as repo } from "./tauri-repository";

const libraryKey = (library: string | null) => ["library", library] as const;

export function useLibrary() {
  const library = useSettings((s) => s.libraryPath);
  return useQuery({
    queryKey: libraryKey(library),
    queryFn: () => repo.list(library as string),
    enabled: library !== null,
  });
}

export function useSnippet(id: string) {
  const { data, ...rest } = useLibrary();
  return { ...rest, snippet: data?.snippets.find((s) => s.id === id) ?? null };
}

/** Mutation sur la bibliothèque courante, qui relit le dossier une fois terminée. */
function useLibraryMutation<T>(action: (library: string, input: T) => Promise<void>) {
  const library = useSettings((s) => s.libraryPath);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: T) => {
      if (!library) throw new Error("Aucune bibliothèque sélectionnée");
      await action(library, input);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: libraryKey(library) }),
  });
}

export const useCreateSnippet = () => useLibraryMutation<RawSnippet>(repo.create);
export const useUpdateSnippet = () => useLibraryMutation<RawSnippet>(repo.write);
export const useDeleteSnippet = () => useLibraryMutation<string>(repo.delete);

export const useCreateSamples = () =>
  useLibraryMutation<void>(async (library) => {
    for (const snippet of sampleSnippets()) await repo.write(library, snippet);
  });
