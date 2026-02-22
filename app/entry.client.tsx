import { startTransition } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";

startTransition(() => {
  hydrateRoot(document, <HydratedRouter />, {
    onRecoverableError(error) {
      // Suppress hydration mismatch errors in embedded Shopify apps.
      // App Bridge and Vite inject tags into <head> that don't exist
      // in the server-rendered HTML, causing expected mismatches.
      if (
        error instanceof Error &&
        error.message.includes("Hydration")
      ) {
        return;
      }
      console.error(error);
    },
  });
});
