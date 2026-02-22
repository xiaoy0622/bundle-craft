import { useEffect, useRef } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  getBundles,
  deleteBundle,
  duplicateBundle,
  archiveBundle,
  activateBundle,
} from "../models/bundle.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const status = url.searchParams.get("status") || "all";

  const bundles = await getBundles(session.shop, status);
  const allBundles = await getBundles(session.shop);

  const stats = {
    total: allBundles.length,
    active: allBundles.filter((b) => b.status === "active").length,
    draft: allBundles.filter((b) => b.status === "draft").length,
  };

  // Format dates on the server to avoid hydration mismatch
  const formattedBundles = bundles.map((b) => ({
    ...b,
    formattedDate: new Date(b.createdAt).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    }),
  }));

  return { bundles: formattedBundles, stats, status };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;
  const bundleId = formData.get("bundleId") as string;

  switch (intent) {
    case "delete":
      await deleteBundle(bundleId, session.shop, admin);
      break;
    case "duplicate":
      await duplicateBundle(bundleId, session.shop);
      break;
    case "archive":
      await archiveBundle(bundleId, session.shop, admin);
      break;
    case "activate":
      await activateBundle(bundleId, session.shop, admin);
      break;
  }

  return { ok: true };
};

/**
 * Hook to attach a native click listener via ref.
 * Needed for <s-button> in <s-page> slots where React's onClick doesn't fire.
 */
function useSlotClick(handler: () => void) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.addEventListener("click", handler);
    return () => el.removeEventListener("click", handler);
  }, [handler]);
  return ref;
}

export default function BundleDashboard() {
  const { bundles, stats, status } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const fetcher = useFetcher();
  const shopify = useAppBridge();

  const isDeleting = fetcher.state !== "idle";

  const createBtnRef = useSlotClick(() => navigate("/app/bundles/new"));

  useEffect(() => {
    if (fetcher.data && fetcher.state === "idle") {
      shopify.toast.show("Action completed");
    }
  }, [fetcher.data, fetcher.state, shopify]);

  const handleAction = (intent: string, bundleId: string) => {
    if (intent === "delete") {
      // eslint-disable-next-line no-restricted-globals
      if (!confirm("Are you sure you want to delete this bundle?")) return;
    }
    fetcher.submit({ intent, bundleId }, { method: "POST" });
  };

  const handleFilterChange = (e: any) => {
    const newStatus = e.currentTarget.value;
    navigate(newStatus === "all" ? "/app" : `/app?status=${newStatus}`);
  };

  return (
    <s-page heading="Bundles">
      <s-button
        ref={createBtnRef}
        slot="primary-action"
        variant="primary"
      >
        Create bundle
      </s-button>

      {/* Stats */}
      <s-section>
        <s-stack direction="inline" gap="large">
          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
            background="subdued"
          >
            <s-heading>{stats.total}</s-heading>
            <s-text>Total bundles</s-text>
          </s-box>
          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
            background="subdued"
          >
            <s-heading>{stats.active}</s-heading>
            <s-text>Active</s-text>
          </s-box>
          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
            background="subdued"
          >
            <s-heading>{stats.draft}</s-heading>
            <s-text>Drafts</s-text>
          </s-box>
        </s-stack>
      </s-section>

      {/* Filter */}
      <s-section>
        <s-select
          label="Filter by status"
          value={status}
          onChange={handleFilterChange}
        >
          <s-option value="all">All</s-option>
          <s-option value="active">Active</s-option>
          <s-option value="draft">Draft</s-option>
          <s-option value="archived">Archived</s-option>
        </s-select>
      </s-section>

      {/* Bundle List */}
      {bundles.length === 0 ? (
        <s-section>
          <s-box
            padding="large-200"
            borderWidth="base"
            borderRadius="base"
            background="subdued"
          >
            <s-stack direction="block" gap="base">
              <s-heading>No bundles yet</s-heading>
              <s-paragraph>
                Create your first bundle to start selling product packages.
              </s-paragraph>
              <s-button onClick={() => navigate("/app/bundles/new")}>
                Create bundle
              </s-button>
            </s-stack>
          </s-box>
        </s-section>
      ) : (
        <s-section>
          <s-stack direction="block" gap="base">
            {bundles.map((bundle) => (
              <s-box
                key={bundle.id}
                padding="base"
                borderWidth="base"
                borderRadius="base"
              >
                <s-stack direction="inline" gap="base">
                  <div style={{ flex: 1 }}>
                    <s-stack direction="block" gap="small">
                      <s-stack direction="inline" gap="small">
                        <s-heading>{bundle.title}</s-heading>
                        <s-badge
                          tone={
                            bundle.status === "active"
                              ? "success"
                              : bundle.status === "draft"
                                ? "caution"
                                : "neutral"
                          }
                        >
                          {bundle.status}
                        </s-badge>
                      </s-stack>
                      <s-text>
                        {bundle.components.length} product
                        {bundle.components.length !== 1 ? "s" : ""} &middot;{" "}
                        {bundle.discountType === "percentage"
                          ? `${bundle.discountValue}% off`
                          : bundle.discountType === "fixed_amount"
                            ? `$${bundle.discountValue} off`
                            : `$${bundle.discountValue} fixed price`}
                      </s-text>
                      <s-text>Created {bundle.formattedDate}</s-text>
                    </s-stack>
                  </div>
                  <s-stack direction="inline" gap="small">
                    <s-button
                      variant="tertiary"
                      onClick={() => navigate(`/app/bundles/${bundle.id}`)}
                    >
                      Edit
                    </s-button>
                    <s-button
                      variant="tertiary"
                      onClick={() => handleAction("duplicate", bundle.id)}
                      {...(isDeleting ? { disabled: true } : {})}
                    >
                      Duplicate
                    </s-button>
                    {bundle.status !== "active" && (
                      <s-button
                        variant="tertiary"
                        onClick={() => handleAction("activate", bundle.id)}
                        {...(isDeleting ? { disabled: true } : {})}
                      >
                        Activate
                      </s-button>
                    )}
                    {bundle.status !== "archived" && (
                      <s-button
                        variant="tertiary"
                        onClick={() => handleAction("archive", bundle.id)}
                        {...(isDeleting ? { disabled: true } : {})}
                      >
                        Archive
                      </s-button>
                    )}
                    <s-button
                      variant="tertiary"
                      tone="critical"
                      onClick={() => handleAction("delete", bundle.id)}
                      {...(isDeleting ? { disabled: true } : {})}
                    >
                      Delete
                    </s-button>
                  </s-stack>
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
