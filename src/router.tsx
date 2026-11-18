import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from "@tanstack/react-router";
import { EditSnippetPage, NewSnippetPage } from "./features/editor/pages";
import { Sidebar } from "./features/library/Sidebar";
import { Welcome } from "./features/library/Welcome";
import { SnippetPage } from "./features/snippet/SnippetPage";
import { FileDropTarget, ImportDialog } from "./features/transfer/ImportDialog";
import { UpdateNotice } from "./features/update/UpdateNotice";

const rootRoute = createRootRoute({
  component: () => (
    <div className="flex h-screen bg-slate-950 text-slate-200">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
      <FileDropTarget />
      <ImportDialog />
      <UpdateNotice />
    </div>
  ),
});

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
