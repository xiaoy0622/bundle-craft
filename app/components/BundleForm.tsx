import { useState, useCallback, useMemo } from "react";
import { useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { calculateBundlePrice } from "../utils/pricing";

interface ComponentData {
  productId: string;
  variantId: string;
  productTitle: string;
  variantTitle?: string;
  productImage?: string;
  price: string;
  quantity: number;
}

interface BundleData {
  id?: string;
  title: string;
  description?: string | null;
  status: string;
  discountType: string;
  discountValue: number;
  bundleType: string;
  showOnProduct: boolean;
  badgeText?: string | null;
  components: ComponentData[];
}

interface BundleFormProps {
  bundle?: BundleData;
}

export default function BundleForm({ bundle }: BundleFormProps) {
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const isSubmitting = fetcher.state !== "idle";

  const [title, setTitle] = useState(bundle?.title || "");
  const [description, setDescription] = useState(bundle?.description || "");
  const [status, setStatus] = useState(bundle?.status || "active");
  const [discountType, setDiscountType] = useState(
    bundle?.discountType || "percentage",
  );
  const [discountValue, setDiscountValue] = useState(
    bundle?.discountValue || 0,
  );
  const [showOnProduct, setShowOnProduct] = useState(
    bundle?.showOnProduct ?? true,
  );
  const [badgeText, setBadgeText] = useState(bundle?.badgeText || "");
  const [components, setComponents] = useState<ComponentData[]>(
    bundle?.components || [],
  );

  const originalPrice = useMemo(
    () =>
      components.reduce(
        (sum, c) => sum + parseFloat(c.price || "0") * c.quantity,
        0,
      ),
    [components],
  );

  const bundlePrice = useMemo(
    () => calculateBundlePrice(originalPrice, discountType, discountValue),
    [originalPrice, discountType, discountValue],
  );

  const savings = originalPrice - bundlePrice;

  const handleAddProducts = useCallback(async () => {
    try {
      const selected = await shopify.resourcePicker({
        type: "product",
        multiple: true,
        action: "select",
      });

      if (!selected || selected.length === 0) return;

      const newComponents: ComponentData[] = selected.map((product: any) => {
        const variant = product.variants[0];
        return {
          productId: product.id,
          variantId: variant.id,
          productTitle: product.title,
          variantTitle:
            variant.title !== "Default Title" ? variant.title : undefined,
          productImage:
            product.images?.[0]?.originalSrc ||
            product.images?.[0]?.src ||
            undefined,
          price: variant.price || "0",
          quantity: 1,
        };
      });

      setComponents((prev) => {
        const existingIds = new Set(prev.map((c) => c.variantId));
        const unique = newComponents.filter(
          (c) => !existingIds.has(c.variantId),
        );
        return [...prev, ...unique];
      });
    } catch {
      // User cancelled the picker
    }
  }, [shopify]);

  const handleRemoveComponent = useCallback((variantId: string) => {
    setComponents((prev) => prev.filter((c) => c.variantId !== variantId));
  }, []);

  const handleQuantityChange = useCallback(
    (variantId: string, quantity: number) => {
      setComponents((prev) =>
        prev.map((c) =>
          c.variantId === variantId
            ? { ...c, quantity: Math.max(1, quantity) }
            : c,
        ),
      );
    },
    [],
  );

  const handleSubmit = useCallback(() => {
    if (!title.trim()) {
      shopify.toast.show("Please enter a bundle title", { isError: true });
      return;
    }
    if (components.length < 2) {
      shopify.toast.show("Please add at least 2 products", { isError: true });
      return;
    }

    const formData = new FormData();
    formData.set(
      "data",
      JSON.stringify({
        title: title.trim(),
        description: description.trim() || undefined,
        status,
        discountType,
        discountValue,
        bundleType: "fixed",
        showOnProduct,
        badgeText: badgeText.trim() || undefined,
        components,
      }),
    );
    fetcher.submit(formData, { method: "POST" });
  }, [
    title,
    description,
    status,
    discountType,
    discountValue,
    showOnProduct,
    badgeText,
    components,
    fetcher,
    shopify,
  ]);

  return (
    <>
      {/* Basic Info */}
      <s-section heading="Basic information">
        <s-text-field
          label="Bundle title"
          value={title}
          onChange={(e: any) => setTitle(e.currentTarget.value)}
          required
        />
        <s-text-area
          label="Description (optional)"
          value={description}
          onChange={(e: any) => setDescription(e.currentTarget.value)}
          rows={3}
        />
        <s-select
          label="Status"
          value={status}
          onChange={(e: any) => setStatus(e.currentTarget.value)}
        >
          <s-option value="active">Active</s-option>
          <s-option value="draft">Draft</s-option>
        </s-select>
      </s-section>

      {/* Products */}
      <s-section heading="Products">
        <s-paragraph>
          Select the products to include in this bundle. At least 2 products are
          required.
        </s-paragraph>

        {components.length > 0 && (
          <s-stack direction="block" gap="small">
            {components.map((comp) => (
              <s-box
                key={comp.variantId}
                padding="small"
                borderWidth="base"
                borderRadius="base"
              >
                <s-stack direction="inline" gap="base">
                  {comp.productImage && (
                    <img
                      src={comp.productImage}
                      alt={comp.productTitle}
                      width="48"
                      height="48"
                      style={{
                        borderRadius: "4px",
                        objectFit: "cover" as const,
                      }}
                    />
                  )}
                  <div style={{ flex: 1 }}>
                    <s-stack direction="block" gap="small-200">
                      <s-heading>{comp.productTitle}</s-heading>
                      {comp.variantTitle && (
                        <s-text>{comp.variantTitle}</s-text>
                      )}
                      <s-text>${comp.price}</s-text>
                    </s-stack>
                  </div>
                  <s-stack direction="inline" gap="small">
                    <s-text-field
                      label="Qty"
                      value={String(comp.quantity)}
                      onChange={(e: any) =>
                        handleQuantityChange(
                          comp.variantId,
                          parseInt(e.currentTarget.value) || 1,
                        )
                      }
                    />
                    <s-button
                      variant="tertiary"
                      tone="critical"
                      onClick={() => handleRemoveComponent(comp.variantId)}
                    >
                      Remove
                    </s-button>
                  </s-stack>
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        )}

        <s-button onClick={handleAddProducts}>Add products</s-button>
      </s-section>

      {/* Discount Configuration */}
      <s-section heading="Discount">
        <s-select
          label="Discount type"
          value={discountType}
          onChange={(e: any) => setDiscountType(e.currentTarget.value)}
        >
          <s-option value="percentage">Percentage off</s-option>
          <s-option value="fixed_amount">Fixed amount off</s-option>
          <s-option value="fixed_price">Fixed total price</s-option>
        </s-select>

        <s-text-field
          label={
            discountType === "percentage"
              ? "Discount percentage (%)"
              : discountType === "fixed_amount"
                ? "Discount amount ($)"
                : "Bundle price ($)"
          }
          value={String(discountValue)}
          onChange={(e: any) =>
            setDiscountValue(parseFloat(e.currentTarget.value) || 0)
          }
        />
      </s-section>

      {/* Pricing Preview */}
      {components.length > 0 && discountValue > 0 && (
        <s-section heading="Price preview">
          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
            background="subdued"
          >
            <s-stack direction="block" gap="small">
              <s-stack direction="inline" gap="base">
                <s-text>Original price:</s-text>
                <s-text>${originalPrice.toFixed(2)}</s-text>
              </s-stack>
              <s-stack direction="inline" gap="base">
                <s-heading>Bundle price:</s-heading>
                <s-heading>${bundlePrice.toFixed(2)}</s-heading>
              </s-stack>
              {savings > 0 && (
                <s-stack direction="inline" gap="base">
                  <s-text>Customer saves:</s-text>
                  <s-badge tone="success">
                    ${savings.toFixed(2)} (
                    {((savings / originalPrice) * 100).toFixed(0)}%)
                  </s-badge>
                </s-stack>
              )}
            </s-stack>
          </s-box>
        </s-section>
      )}

      {/* Display Settings */}
      <s-section slot="aside" heading="Display settings">
        <s-checkbox
          label="Show bundle widget on product pages"
          checked={showOnProduct}
          onChange={(e: any) => setShowOnProduct(e.currentTarget.checked)}
        />
        <s-text-field
          label="Badge text (optional)"
          value={badgeText}
          onChange={(e: any) => setBadgeText(e.currentTarget.value)}
          details='e.g. "Save 20%", "Best Value"'
        />
      </s-section>

      {/* Save Button */}
      <s-section slot="aside">
        <s-button
          variant="primary"
          onClick={handleSubmit}
          {...(isSubmitting ? { loading: true, disabled: true } : {})}
        >
          {bundle?.id ? "Save changes" : "Create bundle"}
        </s-button>
      </s-section>
    </>
  );
}
