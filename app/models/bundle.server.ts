import db from "../db.server";
import { calculateBundlePrice } from "../utils/pricing";
export { calculateBundlePrice };

export interface BundleComponentInput {
  productId: string;
  variantId: string;
  productTitle: string;
  variantTitle?: string;
  productImage?: string;
  price: string;
  quantity: number;
}

export interface BundleInput {
  title: string;
  description?: string;
  status: string;
  discountType: string;
  discountValue: number;
  bundleType: string;
  showOnProduct: boolean;
  badgeText?: string;
  components: BundleComponentInput[];
}

export async function getBundles(shop: string, status?: string) {
  const where: Record<string, unknown> = { shop };
  if (status && status !== "all") {
    where.status = status;
  }
  return db.bundle.findMany({
    where,
    include: { components: { orderBy: { sortOrder: "asc" } } },
    orderBy: { createdAt: "desc" },
  });
}

export async function getBundle(id: string, shop: string) {
  return db.bundle.findFirst({
    where: { id, shop },
    include: { components: { orderBy: { sortOrder: "asc" } } },
  });
}

async function fetchVariantPrices(
  admin: { graphql: (...args: any[]) => any },
  variantIds: string[],
): Promise<Record<string, string>> {
  const prices: Record<string, string> = {};
  if (variantIds.length === 0) return prices;

  const response = await admin.graphql(
    `#graphql
    query getVariantPrices($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on ProductVariant {
          id
          price
        }
      }
    }`,
    { variables: { ids: variantIds } },
  );
  const json = await response.json();
  for (const node of json.data?.nodes || []) {
    if (node?.id && node?.price) {
      prices[node.id] = node.price;
    }
  }
  return prices;
}

export async function createBundle(
  shop: string,
  admin: { graphql: (...args: any[]) => any },
  data: BundleInput,
) {
  // Fetch real prices from Shopify
  const variantIds = data.components.map((c) => c.variantId);
  const variantPrices = await fetchVariantPrices(admin, variantIds);

  // Enrich components with real prices
  const enrichedComponents = data.components.map((c) => ({
    ...c,
    price: variantPrices[c.variantId] || c.price,
  }));

  const originalPrice = enrichedComponents.reduce(
    (sum, c) => sum + parseFloat(c.price) * c.quantity,
    0,
  );
  const bundlePrice = calculateBundlePrice(
    originalPrice,
    data.discountType,
    data.discountValue,
  );

  // Step 1: Save to local database
  const bundle = await db.bundle.create({
    data: {
      shop,
      title: data.title,
      description: data.description,
      status: data.status || "active",
      discountType: data.discountType || "percentage",
      discountValue: data.discountValue || 0,
      bundleType: data.bundleType || "fixed",
      showOnProduct: data.showOnProduct ?? true,
      badgeText: data.badgeText,
      components: {
        create: enrichedComponents.map((comp, idx) => ({
          productId: comp.productId,
          variantId: comp.variantId,
          productTitle: comp.productTitle,
          variantTitle: comp.variantTitle,
          productImage: comp.productImage,
          price: comp.price,
          quantity: comp.quantity,
          sortOrder: idx,
        })),
      },
    },
    include: { components: true },
  });

  // Step 2: Create Shopify product as bundle parent
  const productResponse = await admin.graphql(
    `#graphql
    mutation productCreate($product: ProductCreateInput!) {
      productCreate(product: $product) {
        product {
          id
          handle
          variants(first: 1) {
            edges {
              node {
                id
              }
            }
          }
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        product: {
          title: data.title,
          descriptionHtml: data.description || "",
          productType: "Bundle",
          tags: ["bundlecraft", "bundle"],
          status: data.status === "draft" ? "DRAFT" : "ACTIVE",
          claimOwnership: { bundles: true },
        },
      },
    },
  );

  const productJson = await productResponse.json();
  const product = productJson.data?.productCreate?.product;

  if (!product) {
    console.error(
      "Product creation failed:",
      productJson.data?.productCreate?.userErrors,
    );
    return bundle;
  }

  const productId = product.id;
  const variantId = product.variants.edges[0]?.node?.id;

  if (variantId) {
    const variantRefs = data.components.map((c) => c.variantId);
    const variantQtys = data.components.map((c) => c.quantity);

    // Step 3: Update variant with requiresComponents and price
    await admin.graphql(
      `#graphql
      mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
          productVariants {
            id
          }
          userErrors {
            field
            message
          }
        }
      }`,
      {
        variables: {
          productId,
          variants: [
            {
              id: variantId,
              price: bundlePrice.toFixed(2),
              requiresComponents: true,
            },
          ],
        },
      },
    );

    // Step 4: Set component metafields on variant
    await admin.graphql(
      `#graphql
      mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields {
            id
          }
          userErrors {
            field
            message
          }
        }
      }`,
      {
        variables: {
          metafields: [
            {
              ownerId: variantId,
              namespace: "custom",
              key: "component_reference",
              type: "list.variant_reference",
              value: JSON.stringify(variantRefs),
            },
            {
              ownerId: variantId,
              namespace: "custom",
              key: "component_quantities",
              type: "list.number_integer",
              value: JSON.stringify(variantQtys),
            },
          ],
        },
      },
    );
  }

  // Step 5: Publish product to online store
  await publishProduct(admin, productId);

  // Step 6: Set bundle offer metafields on component products
  const componentProductIds = data.components.map((c) => c.productId);
  await syncBundleOffersOnProducts(admin, componentProductIds);

  // Step 7: Update local DB with Shopify IDs
  await db.bundle.update({
    where: { id: bundle.id },
    data: { productId, variantId },
  });

  return { ...bundle, productId, variantId };
}

export async function updateBundle(
  id: string,
  shop: string,
  admin: { graphql: (...args: any[]) => any },
  data: BundleInput,
) {
  // Track old component products for metafield cleanup
  const oldComponents = await db.bundleComponent.findMany({
    where: { bundleId: id },
  });
  const oldProductIds = oldComponents.map((c) => c.productId);

  // Fetch real prices from Shopify
  const variantIds = data.components.map((c) => c.variantId);
  const variantPrices = await fetchVariantPrices(admin, variantIds);

  const enrichedComponents = data.components.map((c) => ({
    ...c,
    price: variantPrices[c.variantId] || c.price,
  }));

  const originalPrice = enrichedComponents.reduce(
    (sum, c) => sum + parseFloat(c.price) * c.quantity,
    0,
  );
  const bundlePrice = calculateBundlePrice(
    originalPrice,
    data.discountType,
    data.discountValue,
  );

  // Replace components
  await db.bundleComponent.deleteMany({ where: { bundleId: id } });

  const bundle = await db.bundle.update({
    where: { id },
    data: {
      title: data.title,
      description: data.description,
      status: data.status || "active",
      discountType: data.discountType || "percentage",
      discountValue: data.discountValue || 0,
      bundleType: data.bundleType || "fixed",
      showOnProduct: data.showOnProduct ?? true,
      badgeText: data.badgeText,
      components: {
        create: enrichedComponents.map((comp, idx) => ({
          productId: comp.productId,
          variantId: comp.variantId,
          productTitle: comp.productTitle,
          variantTitle: comp.variantTitle,
          productImage: comp.productImage,
          price: comp.price,
          quantity: comp.quantity,
          sortOrder: idx,
        })),
      },
    },
    include: { components: true },
  });

  // Update Shopify product if it exists
  if (bundle.productId && bundle.variantId) {
    const variantRefs = data.components.map((c) => c.variantId);
    const variantQtys = data.components.map((c) => c.quantity);

    await admin.graphql(
      `#graphql
      mutation productUpdate($product: ProductUpdateInput!) {
        productUpdate(product: $product) {
          product {
            id
          }
          userErrors {
            field
            message
          }
        }
      }`,
      {
        variables: {
          product: {
            id: bundle.productId,
            title: data.title,
            descriptionHtml: data.description || "",
            status: data.status === "draft" ? "DRAFT" : "ACTIVE",
          },
        },
      },
    );

    await admin.graphql(
      `#graphql
      mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
          productVariants {
            id
          }
          userErrors {
            field
            message
          }
        }
      }`,
      {
        variables: {
          productId: bundle.productId,
          variants: [
            {
              id: bundle.variantId,
              price: bundlePrice.toFixed(2),
            },
          ],
        },
      },
    );

    await admin.graphql(
      `#graphql
      mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields {
            id
          }
          userErrors {
            field
            message
          }
        }
      }`,
      {
        variables: {
          metafields: [
            {
              ownerId: bundle.variantId,
              namespace: "custom",
              key: "component_reference",
              type: "list.variant_reference",
              value: JSON.stringify(variantRefs),
            },
            {
              ownerId: bundle.variantId,
              namespace: "custom",
              key: "component_quantities",
              type: "list.number_integer",
              value: JSON.stringify(variantQtys),
            },
          ],
        },
      },
    );
  }

  // Sync bundle offer metafields on both old and new component products
  const newProductIds = data.components.map((c) => c.productId);
  const allAffectedProductIds = [...new Set([...oldProductIds, ...newProductIds])];
  await syncBundleOffersOnProducts(admin, allAffectedProductIds);

  return bundle;
}

export async function deleteBundle(
  id: string,
  shop: string,
  admin: { graphql: (...args: any[]) => any },
) {
  const bundle = await db.bundle.findFirst({
    where: { id, shop },
    include: { components: true },
  });
  if (!bundle) return null;

  // Track component products for metafield cleanup
  const componentProductIds = bundle.components.map((c) => c.productId);

  if (bundle.productId) {
    await admin.graphql(
      `#graphql
      mutation productDelete($input: ProductDeleteInput!) {
        productDelete(input: $input) {
          deletedProductId
          userErrors {
            field
            message
          }
        }
      }`,
      {
        variables: {
          input: { id: bundle.productId },
        },
      },
    );
  }

  await db.bundle.delete({ where: { id } });

  // Re-sync metafields on component products (removes this bundle from their offers)
  await syncBundleOffersOnProducts(admin, componentProductIds);

  return bundle;
}

export async function duplicateBundle(id: string, shop: string) {
  const original = await getBundle(id, shop);
  if (!original) return null;

  return db.bundle.create({
    data: {
      shop,
      title: `${original.title} (Copy)`,
      description: original.description,
      status: "draft",
      discountType: original.discountType,
      discountValue: original.discountValue,
      bundleType: original.bundleType,
      showOnProduct: original.showOnProduct,
      badgeText: original.badgeText,
      components: {
        create: original.components.map((comp, idx) => ({
          productId: comp.productId,
          variantId: comp.variantId,
          productTitle: comp.productTitle,
          variantTitle: comp.variantTitle,
          productImage: comp.productImage,
          price: comp.price,
          quantity: comp.quantity,
          sortOrder: idx,
        })),
      },
    },
    include: { components: true },
  });
}

export async function archiveBundle(
  id: string,
  shop: string,
  admin: { graphql: (...args: any[]) => any },
) {
  const bundle = await db.bundle.findFirst({ where: { id, shop } });
  if (!bundle) return null;

  if (bundle.productId) {
    await admin.graphql(
      `#graphql
      mutation productUpdate($product: ProductUpdateInput!) {
        productUpdate(product: $product) {
          product {
            id
          }
          userErrors {
            field
            message
          }
        }
      }`,
      {
        variables: {
          product: {
            id: bundle.productId,
            status: "ARCHIVED",
          },
        },
      },
    );
  }

  return db.bundle.update({
    where: { id },
    data: { status: "archived" },
  });
}

/**
 * For each given component product, find all active bundles it belongs to
 * and set a JSON metafield with bundle offer info on the product.
 * This powers the "bundle-offer" theme block.
 */
async function syncBundleOffersOnProducts(
  admin: { graphql: (...args: any[]) => any },
  componentProductIds: string[],
) {
  const uniqueIds = [...new Set(componentProductIds)];

  for (const productId of uniqueIds) {
    // Find all active bundles containing this product
    const components = await db.bundleComponent.findMany({
      where: { productId },
      include: { bundle: true },
    });

    const activeBundles = components
      .map((c) => c.bundle)
      .filter((b) => b.status === "active" && b.productId);

    // Build offers array with bundle info
    const offers = await Promise.all(
      activeBundles.map(async (b) => {
        // Fetch the bundle product handle for storefront linking
        let handle = "";
        try {
          const res = await admin.graphql(
            `#graphql
            query getProductHandle($id: ID!) {
              product(id: $id) { handle }
            }`,
            { variables: { id: b.productId } },
          );
          const json = await res.json();
          handle = json.data?.product?.handle || "";
        } catch {
          // Ignore — link will just be empty
        }

        let discountLabel = "";
        if (b.discountType === "percentage") {
          discountLabel = `${b.discountValue}%`;
        } else if (b.discountType === "fixed_amount") {
          discountLabel = `$${b.discountValue}`;
        }

        return {
          bundleTitle: b.title,
          discountType: b.discountType,
          discountValue: b.discountValue,
          discountLabel,
          handle,
        };
      }),
    );

    await admin.graphql(
      `#graphql
      mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { id }
          userErrors { field message }
        }
      }`,
      {
        variables: {
          metafields: [
            {
              ownerId: productId,
              namespace: "custom",
              key: "bundle_offers",
              type: "json",
              value: JSON.stringify(offers),
            },
          ],
        },
      },
    );
  }
}

async function publishProduct(
  admin: { graphql: (...args: any[]) => any },
  productId: string,
) {
  // Get the online store publication
  const pubResponse = await admin.graphql(
    `#graphql
    query publications {
      publications(first: 10) {
        nodes {
          id
          name
        }
      }
    }`,
  );
  const pubJson = await pubResponse.json();
  const onlineStore = pubJson.data?.publications?.nodes?.find(
    (p: { name: string }) =>
      p.name === "Online Store" || p.name === "online_store",
  );

  if (onlineStore) {
    await admin.graphql(
      `#graphql
      mutation publishablePublish($id: ID!, $input: [PublicationInput!]!) {
        publishablePublish(id: $id, input: $input) {
          publishable {
            availablePublicationsCount {
              count
            }
          }
          userErrors {
            field
            message
          }
        }
      }`,
      {
        variables: {
          id: productId,
          input: [{ publicationId: onlineStore.id }],
        },
      },
    );
  }
}

export async function ensureCartTransform(admin: { graphql: (...args: any[]) => any }) {
  // Check if cart transform already exists
  const response = await admin.graphql(
    `#graphql
    query cartTransforms {
      cartTransforms(first: 10) {
        nodes {
          id
          functionId
        }
      }
    }`,
  );
  const json = await response.json();
  const transforms = json.data?.cartTransforms?.nodes || [];

  if (transforms.length > 0) return transforms[0];

  // Create cart transform
  const createResponse = await admin.graphql(
    `#graphql
    mutation cartTransformCreate($functionHandle: String!) {
      cartTransformCreate(functionHandle: $functionHandle, blockOnFailure: false) {
        cartTransform {
          id
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        functionHandle: "bundle-cart-transform",
      },
    },
  );

  const createJson = await createResponse.json();
  return createJson.data?.cartTransformCreate?.cartTransform;
}

export async function ensureMetafieldDefinitions(
  admin: { graphql: (...args: any[]) => any },
) {
  const definitions = [
    {
      key: "component_reference",
      type: "list.variant_reference",
      namespace: "custom",
      name: "Bundle component reference",
      ownerType: "PRODUCTVARIANT",
    },
    {
      key: "component_quantities",
      type: "list.number_integer",
      namespace: "custom",
      name: "Bundle component quantities",
      ownerType: "PRODUCTVARIANT",
    },
    {
      key: "bundle_offers",
      type: "json",
      namespace: "custom",
      name: "Bundle offers",
      ownerType: "PRODUCT",
    },
  ];

  for (const definition of definitions) {
    await admin.graphql(
      `#graphql
      mutation metafieldDefinitionCreate($definition: MetafieldDefinitionInput!) {
        metafieldDefinitionCreate(definition: $definition) {
          createdDefinition {
            id
          }
          userErrors {
            field
            message
          }
        }
      }`,
      {
        variables: { definition },
      },
    );
  }
}
