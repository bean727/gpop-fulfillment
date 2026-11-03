import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import SellerPaymentTerms from "../src/SellerPaymentTerms";
import SellerAutoApproval from "../src/SellerAutoApproval";
import CreditRequestActions, {
  amountOwed,
  paymentStatus,
} from "../src/CreditRequestActions";
const base = {
  id: "test",
  status: "approved",
  payment_terms: "pay_later",
  payment_status: "unpaid",
  quantity: 2,
  unit_cents: 499,
};
it("counts only approved unsettled purchases as owed", () => {
  expect(amountOwed(base)).toBe(998);
  expect(amountOwed({ ...base, payment_status: "reported" })).toBe(998);
  expect(amountOwed({ ...base, payment_status: "verified" })).toBe(0);
  expect(amountOwed({ ...base, status: "under_review" })).toBe(0);
  expect(amountOwed({ ...base, status: "canceled" })).toBe(0);
});
it("supports the pre-migration prepaid display without granting pay-later access", () => {
  expect(paymentStatus({ status: "approved" })).toBe("verified");
  expect(paymentStatus({ status: "pending_payment" })).toBe("unpaid");
});
it("allows an approved pay-later seller to report payment", () => {
  const html = renderToStaticMarkup(
    <CreditRequestActions
      request={base}
      admin={false}
      verified={false}
      payLaterAllowed={true}
      confirm={() => {}}
      verify={() => {}}
    />,
  );
  expect(html).toContain("sent payment");
  expect(html).not.toContain("Approve");
});
it("shows administrator settlement after approval and does not offer another approval", () => {
  const html = renderToStaticMarkup(
    <CreditRequestActions
      request={base}
      admin={true}
      verified={false}
      payLaterAllowed={true}
      confirm={() => {}}
      verify={() => {}}
    />,
  );
  expect(html).toContain("Verify payment");
  expect(html).not.toContain("Approve");
});
it("prepaid requests have no unpaid approval control", () => {
  const html = renderToStaticMarkup(
    <CreditRequestActions
      request={{ ...base, status: "pending_payment", payment_terms: "prepaid" }}
      admin={true}
      verified={false}
      payLaterAllowed={true}
      confirm={() => {}}
      verify={() => {}}
    />,
  );
  expect(html).not.toContain("Approve");
});
it("displays adjusted receivables and preserves an explicit zero", () => {
  expect(amountOwed({ ...base, outstanding_cents: 300 })).toBe(300);
  expect(amountOwed({ ...base, outstanding_cents: 0 })).toBe(0);
  expect(
    amountOwed({ ...base, outstanding_cents: 300, payment_status: "verified" }),
  ).toBe(0);
});
it("does not offer payment verification for an adjusted zero balance", () => {
  const html = renderToStaticMarkup(
    <CreditRequestActions
      request={{ ...base, outstanding_cents: 0 }}
      admin={true}
      verified={false}
      payLaterAllowed={true}
      confirm={() => {}}
      verify={() => {}}
    />,
  );
  expect(html).not.toContain("Verify payment");
});
it("leaves the permission reason optional", () => {
  const html = renderToStaticMarkup(
    <SellerPaymentTerms
      seller={{ id: "test", email: "test@example.test" }}
      onSave={() => {}}
    />,
  );
  expect(html).toContain("Reason for this permission (optional)");
  expect(html).not.toMatch(/<textarea[^>]*required/);
});
it("defaults auto-approval controls to manual and explains payment and inventory gates", () => {
  const html = renderToStaticMarkup(
    <SellerAutoApproval
      seller={{ id: "test", email: "seller@example.test" }}
      onSave={() => {}}
    />,
  );
  expect(html).toContain('value="manual" selected');
  expect(html).toContain("verified payment");
  expect(html).toContain("exceed available stock");
  expect(html).not.toMatch(/<textarea[^>]*required/);
});
it("displays enabled future automatic approval for a permitted seller", () => {
  const html = renderToStaticMarkup(
    <SellerAutoApproval
      seller={{ id: "test", auto_approve_credits: true }}
      onSave={() => {}}
    />,
  );
  expect(html).toContain('value="auto" selected');
  expect(html).toContain("only to requests submitted after");
});
