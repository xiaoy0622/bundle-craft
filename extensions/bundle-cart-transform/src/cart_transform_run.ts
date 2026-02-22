import type {
  CartTransformRunInput,
  CartTransformRunResult,
  Operation,
} from "../generated/api";

const NO_CHANGES: CartTransformRunResult = {
  operations: [],
};

export function cartTransformRun(
  input: CartTransformRunInput,
): CartTransformRunResult {
  const operations: Operation[] = [];

  for (const line of input.cart.lines) {
    if (line.merchandise.__typename !== "ProductVariant") {
      continue;
    }

    const componentRef = line.merchandise.component_reference;
    if (!componentRef?.jsonValue) {
      continue;
    }

    const componentRefs = componentRef.jsonValue as string[];
    if (componentRefs.length === 0) {
      continue;
    }

    const componentQtys = (
      line.merchandise.component_quantities?.jsonValue || []
    ) as number[];

    operations.push({
      lineExpand: {
        cartLineId: line.id,
        expandedCartItems: componentRefs.map(
          (merchandiseId: string, idx: number) => ({
            merchandiseId,
            quantity: componentQtys[idx] ?? 1,
          }),
        ),
      },
    });
  }

  if (operations.length === 0) {
    return NO_CHANGES;
  }

  return { operations };
}
