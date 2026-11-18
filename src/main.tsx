import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { router } from "./router";
import { useSettings } from "./state/settings";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    // Données locales : pas de refetch automatique au focus, on relit à la demande.
    queries: { refetchOnWindowFocus: false, retry: false },
  },
});

const root = createRoot(document.getElementById("root") as HTMLElement);

useSettings
  .getState()
  .init()
  .catch((e) => console.error("Lecture des réglages impossible", e))
  .finally(() => {
    root.render(
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </StrictMode>,
    );
  });
