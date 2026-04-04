import db from "../db.server";
import { unauthenticated } from "../shopify.server";

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export async function syncProducts(
  shop: string,
  admin?: { graphql: (...args: unknown[]) => unknown },
) {
  const gqlAdmin = admin ?? (await unauthenticated.admin(shop)).admin;

  let hasNextPage = true;
  let cursor: string | null = null;
  const syncedIds: string[] = [];

  while (hasNextPage) {
    const response = (await (gqlAdmin as { graphql: Function }).graphql(
      `#graphql
      query Products($cursor: String) {
        products(first: 50, after: $cursor, sortKey: TITLE) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            handle
            title
            description
            productType
            vendor
            tags
            status
            priceRange {
              minVariantPrice { amount currencyCode }
              maxVariantPrice { amount currencyCode }
            }
            featuredImage { url }
            images(first: 1) { nodes { url } }
            totalInventory
            tracksInventory
          }
        }
      }`,
      { variables: { cursor } },
    )) as Response;

    const data = await response.json();
    const products = data.data?.products;
    if (!products) break;

    for (const p of products.nodes) {
      const minRaw = parseFloat(p.priceRange?.minVariantPrice?.amount || "0") / 100;
      const maxRaw = parseFloat(p.priceRange?.maxVariantPrice?.amount || "0") / 100;
      const currency = p.priceRange?.minVariantPrice?.currencyCode || "USD";
      const fmt = (n: number) => {
        try {
          return new Intl.NumberFormat("en", { style: "currency", currency }).format(n);
        } catch {
          return `$${n.toFixed(2)}`;
        }
      };
      const priceRangeStr =
        minRaw === maxRaw ? fmt(minRaw) : `${fmt(minRaw)} - ${fmt(maxRaw)}`;

      await db.storeProduct.upsert({
        where: { shop_productId: { shop, productId: p.id } },
        create: {
          shop,
          productId: p.id,
          handle: p.handle,
          title: p.title,
          description: stripHtml(p.description || ""),
          productType: p.productType || "",
          vendor: p.vendor || "",
          tags: (p.tags || []).join(", "),
          priceRange: priceRangeStr,
          status: p.status,
          imageUrl: p.featuredImage?.url || p.images?.nodes?.[0]?.url || null,
          inventoryQuantity: p.totalInventory ?? null,
          tracksInventory: p.tracksInventory ?? true,
        },
        update: {
          handle: p.handle,
          title: p.title,
          description: stripHtml(p.description || ""),
          productType: p.productType || "",
          vendor: p.vendor || "",
          tags: (p.tags || []).join(", "),
          priceRange: priceRangeStr,
          status: p.status,
          imageUrl: p.featuredImage?.url || p.images?.nodes?.[0]?.url || null,
          inventoryQuantity: p.totalInventory ?? null,
          tracksInventory: p.tracksInventory ?? true,
          syncedAt: new Date(),
        },
      });
      syncedIds.push(p.id);
    }

    hasNextPage = products.pageInfo.hasNextPage;
    cursor = products.pageInfo.endCursor;
  }

  // Remove products no longer in Shopify
  if (syncedIds.length > 0) {
    await db.storeProduct.deleteMany({
      where: { shop, productId: { notIn: syncedIds } },
    });
  }

  return syncedIds.length;
}

export async function syncPages(
  shop: string,
  admin?: { graphql: (...args: unknown[]) => unknown },
) {
  const gqlAdmin = admin ?? (await unauthenticated.admin(shop)).admin;

  let hasNextPage = true;
  let cursor: string | null = null;
  const syncedIds: string[] = [];

  while (hasNextPage) {
    const response = (await (gqlAdmin as { graphql: Function }).graphql(
      `#graphql
      query Pages($cursor: String) {
        pages(first: 50, after: $cursor, query: "published_status:published") {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            handle
            title
            body
            metafields(first: 10) {
              nodes {
                namespace
                key
                value
              }
            }
          }
        }
      }`,
      { variables: { cursor } },
    )) as Response;

    const data = await response.json();
    const pages = data.data?.pages;
    if (!pages) break;

    for (const p of pages.nodes) {
      // Build body from page content + metafields
      let body = stripHtml(p.body || "");

      const metafields = p.metafields?.nodes || [];
      const metafieldLabels: Record<string, string> = {
        phone: "Phone",
        email: "Email",
        addresslocation: "Address",
        tradinghours: "Trading Hours",
      };

      const metafieldParts: string[] = [];
      for (const mf of metafields) {
        if (mf.namespace === "custom" && metafieldLabels[mf.key]) {
          const cleaned = stripHtml(mf.value || "");
          if (cleaned) {
            metafieldParts.push(`${metafieldLabels[mf.key]}: ${cleaned}`);
          }
        }
      }

      if (metafieldParts.length > 0) {
        body = body
          ? `${body}\n\n${metafieldParts.join("\n")}`
          : metafieldParts.join("\n");
      }

      await db.storePage.upsert({
        where: { shop_pageId: { shop, pageId: p.id } },
        create: {
          shop,
          pageId: p.id,
          handle: p.handle,
          title: p.title,
          body,
        },
        update: {
          handle: p.handle,
          title: p.title,
          body,
          syncedAt: new Date(),
        },
      });
      syncedIds.push(p.id);
    }

    hasNextPage = pages.pageInfo.hasNextPage;
    cursor = pages.pageInfo.endCursor;
  }

  if (syncedIds.length > 0) {
    await db.storePage.deleteMany({
      where: { shop, pageId: { notIn: syncedIds } },
    });
  }

  return syncedIds.length;
}

export async function syncAll(
  shop: string,
  admin?: { graphql: (...args: unknown[]) => unknown },
) {
  const [productCount, pageCount] = await Promise.all([
    syncProducts(shop, admin),
    syncPages(shop, admin),
  ]);
  return { productCount, pageCount };
}

export async function getStoreKnowledge(shop: string) {
  const [products, pages] = await Promise.all([
    db.storeProduct.findMany({
      where: { shop, status: "ACTIVE" },
      orderBy: { title: "asc" },
    }),
    db.storePage.findMany({
      where: { shop },
      orderBy: { title: "asc" },
    }),
  ]);
  return { products, pages };
}

export async function getSyncStatus(shop: string) {
  const [productCount, pageCount, lastProduct, lastPage] = await Promise.all([
    db.storeProduct.count({ where: { shop } }),
    db.storePage.count({ where: { shop } }),
    db.storeProduct.findFirst({
      where: { shop },
      orderBy: { syncedAt: "desc" },
      select: { syncedAt: true },
    }),
    db.storePage.findFirst({
      where: { shop },
      orderBy: { syncedAt: "desc" },
      select: { syncedAt: true },
    }),
  ]);

  const lastSynced = lastProduct?.syncedAt || lastPage?.syncedAt || null;
  return { productCount, pageCount, lastSynced };
}
