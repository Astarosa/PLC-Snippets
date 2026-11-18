import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from "@tanstack/react-router";
import { Sidebar } from "./features/library/Sidebar";
import { Welcome } from "./features/library/Welcome";
import { SnippetPage } from "./features/snippet/SnippetPage";

const rootRoute = createRootRoute({
  component: () => (
    <div className="flex h-screen bg-slate-950 text-slate-200">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  ),
});

const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: Welcome });

const snippetRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/snippets/$snippetId",
  component: SnippetPage,
});

export const router = createRouter({
  routeTree: rootRoute.addChildren([indexRoute, snippetRoute]),
  // Historique en hash : robuste dans une webview, pas de serveur à configurer.
  history: createHashHistory(),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
