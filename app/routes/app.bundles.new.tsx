import { useEffect } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { redirect, useNavigate } from "react-router";
import { useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { createBundle } from "../models/bundle.server";
import BundleForm from "../components/BundleForm";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const data = JSON.parse(formData.get("data") as string);

  const bundle = await createBundle(session.shop, admin, data);

  return redirect(`/app/bundles/${bundle.id}`);
};

export default function NewBundle() {
  const navigate = useNavigate();
  const fetcher = useFetcher();
  const shopify = useAppBridge();

  useEffect(() => {
    if (fetcher.data && fetcher.state === "idle") {
      shopify.toast.show("Bundle created successfully");
    }
  }, [fetcher.data, fetcher.state, shopify]);

  return (
    <s-page heading="Create bundle">
      <s-button slot="secondary-action" onClick={() => navigate("/app")}>
        Back
      </s-button>
      <BundleForm />
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
