import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  // This app does not store customer data, so there is nothing to redact.
  // If your app stores customer data in the future, delete it here.

  return new Response();
};
