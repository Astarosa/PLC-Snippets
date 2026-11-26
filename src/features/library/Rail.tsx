import { Link } from "@tanstack/react-router";
import { HomeIcon, MenuIcon, SearchIcon } from "../../components/icons";
import { ThemeToggle } from "../../components/ThemeToggle";
import { useLibraryFilters } from "../../state/library-filters";

/**
 * Bibliothèque repliée pendant l'édition : laisse la largeur au schéma et au panneau
 * de droite. Un clic la déploie (la recherche prend le focus avec la loupe).
 */
export function Rail({ onExpand }: { onExpand: () => void }) {
  const focusSearch = useLibraryFilters((s) => s.focusSearch);
  const button =
    "flex h-10 w-10 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-slate-100";
  return (
    <nav
      aria-label="Bibliothèque (repliée)"
      className="flex w-14 shrink-0 flex-col items-center gap-2 border-r border-slate-800 bg-slate-900 py-3"
    >
      <button
        type="button"
        aria-label="Afficher la bibliothèque"
        title="Afficher la bibliothèque"
        onClick={onExpand}
        className={button}
      >
        <MenuIcon />
      </button>
      <Link to="/" aria-label="Accueil" title="Accueil" className={button}>
        <HomeIcon />
      </Link>
      <button
        type="button"
        aria-label="Rechercher dans la bibliothèque"
        title="Rechercher (Ctrl+F)"
        onClick={() => {
          onExpand();
          focusSearch();
        }}
        className={button}
      >
        <SearchIcon />
      </button>
      <ThemeToggle className="mt-auto h-10 w-10" />
    </nav>
  );
}
