import { useState } from "react";
import type { Row } from "./domain";
export default function SellerAutoApproval({
  seller,
  onSave,
}: {
  seller: Row;
  onSave: (payload: Row) => void;
}) {
  const [enabled, setEnabled] = useState(!!seller.auto_approve_credits);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          seller_id: seller.id,
          enabled,
          reason: new FormData(e.currentTarget).get("reason"),
        });
      }}
    >
      <p>{seller.email}</p>
      <label className="field">
        <span>Approval for future credit requests</span>
        <select
          value={enabled ? "auto" : "manual"}
          onChange={(e) => setEnabled(e.target.value === "auto")}
        >
          <option value="manual">Manual approval</option>
          <option value="auto">Automatically approve new requests</option>
        </select>
      </label>
      <div className="info">
        This applies only to requests submitted after you enable it. Pay-later
        sellers can be approved immediately. Pay-upfront sellers still require
        verified payment before credits are issued. Requests that exceed
        available stock stay in review. Turning this off stops future automatic
        approvals, including requests still awaiting payment.
      </div>
      <label className="field">
        <span>Reason (optional)</span>
        <textarea name="reason" maxLength={2000} />
      </label>
      <button className="primary full">Save approval setting</button>
    </form>
  );
}
