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
  getBundle,
  updateBundle,
  deleteBundle,
} from "../models/bundle.server";
import BundleForm from "../components/BundleForm";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const bundle = await getBundle(params.id!, session.shop);

  if (!bundle) {
    throw new Response("Bundle not found", { status: 404 });
  }

  return {
    bundle: {
      ...bundle,
      description: bundle.description ?? undefined,
      badgeText: bundle.badgeText ?? undefined,
      components: bundle.components.map((c) => ({
        productId: c.productId,
        variantId: c.variantId,
        productTitle: c.productTitle,
        variantTitle: c.variantTitle ?? undefined,
        productImage: c.productImage ?? undefined,
        price: c.price,
        quantity: c.quantity,
      })),
    },
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, session, redirect } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "delete") {
    await deleteBundle(params.id!, session.shop, admin);
    return redirect("/app");
  }

  const data = JSON.parse(formData.get("data") as string);
  await updateBundle(params.id!, session.shop, admin, data);

  return { ok: true };
};

export default function EditBundle() {
  const { bundle } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const backBtnRef = useRef<HTMLElement>(null);
  const deleteBtnRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = backBtnRef.current;
    if (!el) return;
    const handler = () => navigate("/app");
    el.addEventListener("click", handler);
    return () => el.removeEventListener("click", handler);
  }, [navigate]);

  useEffect(() => {
    const el = deleteBtnRef.current;
    if (!el) return;
    const handler = () => {
      // eslint-disable-next-line no-restricted-globals
      if (!confirm("Are you sure you want to delete this bundle?")) return;
      fetcher.submit({ intent: "delete" }, { method: "POST" });
    };
    el.addEventListener("click", handler);
    return () => el.removeEventListener("click", handler);
  }, [fetcher]);

  useEffect(() => {
    if (fetcher.data && fetcher.state === "idle") {
      shopify.toast.show("Bundle updated successfully");
    }
  }, [fetcher.data, fetcher.state, shopify]);

  return (
    <s-page heading={`Edit: ${bundle.title}`}>
      <s-button ref={backBtnRef} slot="secondary-action">
        Back
      </s-button>
      <s-button
        ref={deleteBtnRef}
        slot="secondary-action"
        tone="critical"
      >
        Delete
      </s-button>
      <BundleForm bundle={bundle} />
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
