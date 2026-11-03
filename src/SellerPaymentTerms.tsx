import { useState } from "react";
import type { Row } from "./domain";

export default function SellerPaymentTerms({
  seller,
  onSave,
}: {
  seller: Row;
  onSave: (payload: Row) => void;
}) {
  const [terms, setTerms] = useState(seller.payment_terms || "prepaid");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          seller_id: seller.id,
          payment_terms: terms,
          reason: new FormData(e.currentTarget).get("reason"),
        });
      }}
    >
      <p className="muted">{seller.email}</p>
      <label className="field">
        <span>Payment permission</span>
        <select value={terms} onChange={(e) => setTerms(e.target.value)}>
          <option value="prepaid">
            Pay upfront — verify payment before approval
          </option>
          <option value="pay_later">
            Pay later — allow approval before payment
          </option>
        </select>
      </label>
      <div className="info">
        {terms === "pay_later"
          ? "Manual approval is required unless you enable automatic approval for this seller. An unpaid approved purchase remains in the payment queue until you verify full payment."
          : "Credits require verified payment before approval. Existing approved pay-later purchases still remain payable."}{" "}
        Changing this permission does not rewrite existing requests.
      </div>
      <label className="field">
        <span>Reason for this permission (optional)</span>
        <textarea name="reason" maxLength={2000} />
      </label>
      <button className="primary full">Save payment permission</button>
    </form>
  );
}
