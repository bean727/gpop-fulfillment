import { expect, it } from "vitest";
import {
  money,
  netProfit,
  positiveInteger,
  validLabel,
  routeFromHash,
} from "../src/domain";
it("decodes hash routes while ignoring authentication token fragments", () => {
  expect(routeFromHash("#Browse%20Products")).toBe("Browse Products");
  expect(routeFromHash("#access_token=secret")).toBe("Dashboard");
  expect(routeFromHash("#%ZZ")).toBe("Dashboard");
});
it("calculates profit with all expenses in cents", () => {
  expect(netProfit(2000, 800, 250, 400, 50)).toBe(500);
  expect(netProfit(1000, 800, 250, 400, 50)).toBe(-500);
});
it("formats currency without floating point price storage", () =>
  expect(money(800)).toBe("$8.00"));
it("validates whole positive quantities", () => {
  for (const n of [0, -1, 1.5, Infinity, NaN, 100001])
    expect(positiveInteger(n)).toBe(false);
  expect(positiveInteger(10)).toBe(true);
});
it("allows only nonempty label types within size limit", () => {
  expect(validLabel({ type: "application/pdf", size: 100 })).toBe(true);
  expect(validLabel({ type: "image/png", size: 0 })).toBe(false);
  expect(validLabel({ type: "text/html", size: 100 })).toBe(false);
  expect(validLabel({ type: "image/jpeg", size: 11 * 1024 * 1024 })).toBe(
    false,
  );
});
