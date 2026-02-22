export function calculateBundlePrice(
  originalPrice: number,
  discountType: string,
  discountValue: number,
): number {
  switch (discountType) {
    case "percentage":
      return originalPrice * (1 - discountValue / 100);
    case "fixed_amount":
      return Math.max(0, originalPrice - discountValue);
    case "fixed_price":
      return discountValue;
    default:
      return originalPrice;
  }
}
