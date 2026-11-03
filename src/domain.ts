export const money = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    n / 100,
  );
export function netProfit(
  sale: number,
  cost: number,
  fees: number,
  shipping: number,
  other: number,
) {
  return sale - cost - fees - shipping - other;
}
export function validLabel(file: Pick<File, "type" | "size">) {
  return (
    ["application/pdf", "image/png", "image/jpeg"].includes(file.type) &&
    file.size > 0 &&
    file.size <= 10 * 1024 * 1024
  );
}
export function positiveInteger(n: number) {
  return Number.isSafeInteger(n) && n > 0 && n <= 100000;
}
export type Row = Record<string, any>;
export function routeFromHash(hash: string) {
  try {
    const route = decodeURIComponent(hash.replace(/^#/, ""));
    return [
      "Dashboard",
      "Browse Products",
      "My Credits",
      "Credit Requests",
      "Submit Shipping Label",
      "My Orders",
      "Activity",
      "Settings",
      "Overview",
      "Products",
      "Inventory",
      "Sellers",
      "Payment Verification",
      "Fulfillment",
      "Activity Logs",
    ].includes(route)
      ? route
      : "Dashboard";
  } catch {
    return "Dashboard";
  }
}
