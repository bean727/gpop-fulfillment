import type { Row } from "./domain";
export function paymentStatus(request: Row) {
  return (
    request.payment_status ||
    (request.status === "approved"
      ? "verified"
      : request.status === "payment_reported"
        ? "reported"
        : "unpaid")
  );
}
export function amountOwed(request: Row) {
  return request.status === "approved" && paymentStatus(request) !== "verified"
    ? (request.outstanding_cents ?? request.quantity * request.unit_cents)
    : 0;
}
export default function CreditRequestActions({
  request: r,
  admin,
  verified,
  payLaterAllowed,
  confirm,
  verify,
}: {
  request: Row;
  admin: boolean;
  verified: boolean;
  payLaterAllowed: boolean;
  confirm: (
    title: string,
    action: string,
    payload: Row,
    reason?: boolean,
  ) => void;
  verify: (r: Row) => void;
}) {
  const open = !["approved", "rejected", "canceled"].includes(r.status);
  const unpaidApproved =
    amountOwed(r) > 0 &&
    r.status === "approved" &&
    r.payment_terms === "pay_later" &&
    !verified;
  const canReport =
    (r.status !== "approved" || amountOwed(r) > 0) &&
    paymentStatus(r) === "unpaid" &&
    (r.status === "pending_payment" ||
      (r.payment_terms === "pay_later" &&
        ["under_review", "approved"].includes(r.status)));
  const onAccount =
    r.payment_terms === "pay_later" && payLaterAllowed && !verified;
  return (
    <div className="table-actions">
      {!admin && canReport && (
        <button
          className="primary small"
          onClick={() =>
            confirm("Report payment sent?", "report_payment", { id: r.id })
          }
        >
          I've sent payment
        </button>
      )}
      {!admin && open && (
        <button
          onClick={() =>
            confirm("Cancel credit request?", "cancel_credit", { id: r.id })
          }
        >
          Cancel
        </button>
      )}
      {admin && (open || unpaidApproved) && (
        <>
          {!verified && (
            <button className="secondary small" onClick={() => verify(r)}>
              Verify payment
            </button>
          )}
          {open && (verified || onAccount) && (
            <button
              className="primary small"
              onClick={() =>
                confirm(
                  onAccount
                    ? `Approve ${r.quantity} credits before payment?`
                    : `Approve ${r.quantity} product credits?`,
                  "approve_credit",
                  { id: r.id },
                  onAccount,
                )
              }
            >
              {onAccount ? "Approve · pay later" : "Approve credits"}
            </button>
          )}
          {open && (
            <button
              onClick={() =>
                confirm(
                  "Reject credit request?",
                  "reject_credit",
                  { id: r.id },
                  true,
                )
              }
            >
              Reject
            </button>
          )}
        </>
      )}
    </div>
  );
}
