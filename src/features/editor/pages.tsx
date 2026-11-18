import { useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { emptyForm, formFromSnippet, formToRaw, type SnippetForm } from "../../core/snippet/form";
import { useCreateSnippet, useSnippet, useUpdateSnippet } from "../../storage/queries";
import { SnippetEditor } from "./SnippetEditor";

function useSave(mode: "create" | "edit") {
  const navigate = useNavigate();
  const create = useCreateSnippet();
  const update = useUpdateSnippet();
  const mutation = mode === "create" ? create : update;
  const [errors, setErrors] = useState<string[]>([]);

  const save = (form: SnippetForm) => {
    const result = formToRaw(form);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors([]);
    mutation.mutate(result.raw, {
      onSuccess: () => navigate({ to: "/snippets/$snippetId", params: { snippetId: form.id } }),
      onError: (e) => setErrors([String(e)]),
    });
  };
  return { save, errors, saving: mutation.isPending };
}

export function NewSnippetPage() {
  const navigate = useNavigate();
  const { save, errors, saving } = useSave("create");
  return (
    <SnippetEditor
      mode="create"
      initial={emptyForm()}
      errors={errors}
      saving={saving}
      onSave={save}
      onCancel={() => navigate({ to: "/" })}
    />
  );
}

export function EditSnippetPage() {
  const { snippetId } = useParams({ from: "/snippets/$snippetId/edit" });
  const navigate = useNavigate();
  const { snippet, isLoading } = useSnippet(snippetId);
  const { save, errors, saving } = useSave("edit");

  if (isLoading) return <p className="p-6 text-sm text-slate-500">Chargement…</p>;
  if (!snippet) return <p className="p-6 text-sm text-red-400">Snippet « {snippetId} » introuvable.</p>;

  return (
    <SnippetEditor
      // Repart d'un formulaire neuf si on change de snippet.
      key={snippet.id}
      mode="edit"
      initial={formFromSnippet(snippet)}
      errors={errors}
      saving={saving}
      onSave={save}
      onCancel={() => navigate({ to: "/snippets/$snippetId", params: { snippetId } })}
    />
  );
}
