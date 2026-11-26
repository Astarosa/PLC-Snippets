import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { EditSnippetPage, NewSnippetPage } from "./features/editor/pages";
import { Rail } from "./features/library/Rail";
import { Sidebar } from "./features/library/Sidebar";
import { Welcome } from "./features/library/Welcome";
import { useShortcuts } from "./features/shortcuts";
import { SnippetPage } from "./features/snippet/SnippetPage";
import { FileDropTarget, ImportDialog } from "./features/transfer/ImportDialog";
import { UpdateNotice } from "./features/update/UpdateNotice";
import { useLibraryFilters } from "./state/library-filters";

function RootLayout() {
  // Pendant l'édition, la bibliothèque se replie en rail pour laisser la place à l'éditeur.
  const editing = useRouterState({
    select: (s) => s.matches.some((m) => m.routeId === "/new" || m.routeId === "/snippets/$snippetId/edit"),
  });
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (editing) setExpanded(false);
  }, [editing]);
  useShortcuts();
  // Ctrl+F pendant l'édition : déplie la bibliothèque pour montrer la recherche.
  const searchFocus = useLibraryFilters((s) => s.searchFocus);
  useEffect(() => {
    if (searchFocus > 0) setExpanded(true);
  }, [searchFocus]);
  return (
    <div className="flex h-screen bg-slate-950 text-slate-200">
      {editing && !expanded ? (
        <Rail onExpand={() => setExpanded(true)} />
      ) : (
        <Sidebar onCollapse={editing ? () => setExpanded(false) : undefined} />
      )}
      <main id="main" className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
      <FileDropTarget />
      <ImportDialog />
      <UpdateNotice />
    </div>
  );
}

const rootRoute = createRootRoute({ component: RootLayout });

const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: Welcome });

const snippetRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/snippets/$snippetId",
  component: SnippetPage,
});

const newSnippetRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/new",
  component: NewSnippetPage,
});

const editSnippetRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/snippets/$snippetId/edit",
  component: EditSnippetPage,
});

export const router = createRouter({
  routeTree: rootRoute.addChildren([indexRoute, newSnippetRoute, snippetRoute, editSnippetRoute]),
  // Historique en hash : robuste dans une webview, pas de serveur à configurer.
  history: createHashHistory(),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
