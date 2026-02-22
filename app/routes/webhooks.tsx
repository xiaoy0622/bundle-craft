import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  switch (topic) {
    case "SHOP_REDACT":
      await db.bundleComponent.deleteMany({
        where: { bundle: { shop } },
      });
      await db.bundle.deleteMany({ where: { shop } });
      await db.appSettings.deleteMany({ where: { shop } });
      await db.session.deleteMany({ where: { shop } });
      break;
    case "CUSTOMERS_DATA_REQUEST":
    case "CUSTOMERS_REDACT":
      // This app does not store customer data
      break;
  }

  return new Response();
};
