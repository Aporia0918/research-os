import "@/i18n";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { createStore, del, get, set } from "idb-keyval";
import { useTranslation } from "react-i18next";
import { Toaster } from "sonner";
import { ApiError, OfflineError } from "@/api/client";
import { qk } from "@/api/queries";
import { ThemeProvider } from "@/components/layout/theme";
import { TooltipProvider } from "@/components/ui/misc";
import { App } from "./App";
import "@jelly/jelly.css";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      gcTime: 7 * 24 * 3600_000,          // keep cached reads for offline viewing
      networkMode: "always",              // we detect offline ourselves (OfflineError) and show the saved copy
      retry: (n, e) => !(e instanceof ApiError && e.status < 500) && !(e instanceof OfflineError) && n < 2,
    },
  },
});

// Session expiry anywhere -> back to the sign-in screen.
queryClient.getQueryCache().subscribe((ev) => {
  const err = ev.query.state.error;
  if (err instanceof ApiError && err.status === 401 && ev.query.queryKey[0] !== "auth") {
    void queryClient.invalidateQueries({ queryKey: qk.auth });
  }
});

const store = createStore("researchos-cache", "queries");
const persister = createAsyncStoragePersister({
  storage: { getItem: (k) => get(k, store), setItem: (k, v) => set(k, v, store), removeItem: (k) => del(k, store) },
});

/** Toasts with translated screen-reader labels (the library defaults are English; found by the zh text scan). */
function LocalizedToaster() {
  const { t } = useTranslation();
  return <Toaster position="bottom-right" richColors closeButton customAriaLabel={t("common.notifications")}
    toastOptions={{ closeButtonAriaLabel: t("common.close") }} />;
}

if ("serviceWorker" in navigator && window.isSecureContext && import.meta.env.PROD) {
  void navigator.serviceWorker.register("/sw.js");
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <ThemeProvider>
      <PersistQueryClientProvider client={queryClient} persistOptions={{ persister, maxAge: 7 * 24 * 3600_000 }}>
        <TooltipProvider>
          <App />
          <LocalizedToaster />
        </TooltipProvider>
      </PersistQueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
