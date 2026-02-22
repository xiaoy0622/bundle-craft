import { useState, useEffect, useRef, useCallback } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData } from "react-router";
import { useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  // Load settings from DB (or use defaults)
  let settings = await db.appSettings.findFirst({
    where: { shop: session.shop },
  });

  if (!settings) {
    settings = {
      id: "",
      shop: session.shop,
      defaultDiscountType: "percentage",
      defaultBadgeText: "Bundle & Save",
      showSavings: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  return { settings };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();

  const data = {
    defaultDiscountType: formData.get("defaultDiscountType") as string,
    defaultBadgeText: formData.get("defaultBadgeText") as string,
    showSavings: formData.get("showSavings") === "true",
  };

  await db.appSettings.upsert({
    where: { shop: session.shop },
    create: {
      shop: session.shop,
      ...data,
    },
    update: data,
  });

  return { ok: true };
};

export default function Settings() {
  const { settings } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const shopify = useAppBridge();

  const [defaultDiscountType, setDefaultDiscountType] = useState(
    settings.defaultDiscountType,
  );
  const [defaultBadgeText, setDefaultBadgeText] = useState(
    settings.defaultBadgeText,
  );
  const [showSavings, setShowSavings] = useState(settings.showSavings);

  const isSubmitting = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data && fetcher.state === "idle") {
      shopify.toast.show("Settings saved");
    }
  }, [fetcher.data, fetcher.state, shopify]);

  const handleSubmit = useCallback(() => {
    fetcher.submit(
      {
        defaultDiscountType,
        defaultBadgeText,
        showSavings: String(showSavings),
      },
      { method: "POST" },
    );
  }, [fetcher, defaultDiscountType, defaultBadgeText, showSavings]);

  const saveBtnRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = saveBtnRef.current;
    if (!el) return;
    el.addEventListener("click", handleSubmit);
    return () => el.removeEventListener("click", handleSubmit);
  }, [handleSubmit]);

  return (
    <s-page heading="Settings">
      <s-button
        ref={saveBtnRef}
        slot="primary-action"
        variant="primary"
        {...(isSubmitting ? { loading: true } : {})}
      >
        Save
      </s-button>

      <s-section heading="Default settings">
        <s-select
          label="Default discount type"
          value={defaultDiscountType}
          onChange={(e: any) => setDefaultDiscountType(e.currentTarget.value)}
        >
          <s-option value="percentage">Percentage off</s-option>
          <s-option value="fixed_amount">Fixed amount off</s-option>
          <s-option value="fixed_price">Fixed total price</s-option>
        </s-select>

        <s-text-field
          label="Default badge text"
          value={defaultBadgeText}
          onChange={(e: any) => setDefaultBadgeText(e.currentTarget.value)}
          details="Shown on bundle widgets in the storefront"
        />

        <s-checkbox
          label="Show savings amount on bundle widget"
          checked={showSavings}
          onChange={(e: any) => setShowSavings(e.currentTarget.checked)}
        />
      </s-section>

      <s-section slot="aside" heading="About">
        <s-paragraph>
          These settings control the default values when creating new bundles
          and how bundle widgets appear on your storefront.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
