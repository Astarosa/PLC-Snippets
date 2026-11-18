import type { ReactNode } from "react";
import { useSettings } from "../../state/settings";
import { useCreateSamples, useLibrary } from "../../storage/queries";

const button =
  "rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50";

export function Welcome() {
  const libraryPath = useSettings((s) => s.libraryPath);
  const chooseLibrary = useSettings((s) => s.chooseLibrary);
  const { data } = useLibrary();
  const createSamples = useCreateSamples();

  if (!libraryPath) {
    return (
      <Centered title="Bienvenue">
        <p>
          Ta bibliothèque est un simple dossier : un sous-dossier par snippet. Mets-le par exemple dans ton
          Nextcloud pour le synchroniser entre tes PC.
        </p>
        <button type="button" className={button} onClick={chooseLibrary}>
          Choisir le dossier de la bibliothèque
        </button>
      </Centered>
    );
  }

  const empty = data && data.snippets.length === 0 && data.invalid.length === 0;
  if (empty) {
    return (
      <Centered title="Bibliothèque vide">
        <p>Ajoute deux snippets d'exemple pour voir le format sur le disque.</p>
        <button
          type="button"
          className={button}
          disabled={createSamples.isPending}
          onClick={() => createSamples.mutate()}
        >
          Créer les exemples
        </button>
        {createSamples.error && <p className="text-red-400">{String(createSamples.error)}</p>}
      </Centered>
    );
  }

  return (
    <Centered title="PLC Snippets">
      <p>Sélectionne un snippet dans la liste.</p>
    </Centered>
  );
}

function Centered({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="max-w-md space-y-4 text-center text-sm text-slate-400">
        <h2 className="text-xl font-semibold text-slate-100">{title}</h2>
        {children}
      </div>
    </div>
  );
}
