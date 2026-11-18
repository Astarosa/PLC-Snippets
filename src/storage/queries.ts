import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

export function useCreateSamples() {
  const library = useSettings((s) => s.libraryPath);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!library) throw new Error("Aucune bibliothèque sélectionnée");
      for (const snippet of sampleSnippets()) await repo.write(library, snippet);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: libraryKey(library) }),
  });
}
