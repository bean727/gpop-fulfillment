import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { motion } from "motion/react";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Box,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Coins,
  Copy,
  Grid2X2,
  HelpCircle,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  ShoppingBag,
  SlidersHorizontal,
  Truck,
  Upload,
  Users,
  Wallet,
  X,
} from "lucide-react";
import Brand, { BrandMark } from "./Brand";
import JSZip from "jszip";
import LabelStorageCheck from "./LabelStorageCheck";
import SellerAutoApproval from "./SellerAutoApproval";
import SellerPaymentTerms from "./SellerPaymentTerms";
import CreditRequestActions, {
  paymentStatus,
  amountOwed,
} from "./CreditRequestActions";
import {
  command,
  configured,
  db,
  read,
  signedLabel,
  upload,
  needsPasswordFlow,
  invitationFunction,
} from "./api";
import {
  money,
  netProfit,
  positiveInteger,
  validLabel,
  routeFromHash,
} from "./domain";
import type { Row } from "./domain";

const sellerNav = [
  ["Dashboard", LayoutDashboard],
  ["Browse Products", ShoppingBag],
  ["My Credits", Coins],
  ["Credit Requests", Wallet],
  ["Submit Shipping Label", Upload],
  ["My Orders", Truck],
  ["Activity", History],
  ["Settings", Settings],
] as const;
const adminNav = [
  ["Overview", LayoutDashboard],
  ["Products", ShoppingBag],
  ["Inventory", Box],
  ["Sellers", Users],
  ["Payment Verification", Wallet],
  ["Credit Requests", Coins],
  ["Fulfillment", Truck],
  ["Activity Logs", History],
  ["Settings", Settings],
] as const;
const tables = [
  "products",
  "product_variants",
  "product_images",
  "listing_assets",
  "credit_balances",
  "credit_requests",
  "fulfillment_requests",
  "fulfillment_items",
  "shipping_labels",
  "order_status_history",
  "notifications",
  "profiles",
  "settings",
];
const date = (s: string) =>
  new Date(s).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
const status = (s: string) => s.replaceAll("_", " ");
function Badge({ value }: { value: string }) {
  return (
    <span
      className={`badge ${["approved", "completed", "shipped", "accepted"].includes(value) ? "green" : ["rejected", "canceled", "suspended"].includes(value) ? "red" : ""}`}
    >
      {status(value)}
    </span>
  );
}
function Empty({
  icon: Icon = Package,
  title,
  children,
}: {
  icon?: typeof Package;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon size={26} />
      </div>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current
      ?.querySelector<HTMLElement>("button,input,select,textarea")
      ?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
        return;
      }
      if (e.key === "Tab") {
        const elements = Array.from(
          ref.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]",
          ) || [],
        ).filter((el) => el.offsetParent !== null);
        const first = elements[0],
          last = elements.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = oldOverflow;
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <section
        ref={ref}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-head">
          <h2>{title}</h2>
          <button aria-label="Close dialog" onClick={close}>
            <X />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState<any>(null),
    [loading, setLoading] = useState(configured),
    [data, setData] = useState<Record<string, Row[]>>({}),
    [page, setPage] = useState(routeFromHash(location.hash)),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [modal, setModal] = useState<ReactNode>(null),
    [showDeleted, setShowDeleted] = useState(false),
    [showDeletedCredits, setShowDeletedCredits] = useState(false),
    [orderManagement, setOrderManagement] = useState(false),
    [accountControls, setAccountControls] = useState(false),
    [autoApprovalControls, setAutoApprovalControls] = useState(false),
    [search, setSearch] = useState(""),
    [category, setCategory] = useState("All categories"),
    [sort, setSort] = useState("newest"),
    [mobile, setMobile] = useState(false),
    [recovery, setRecovery] = useState(needsPasswordFlow),
    [assetUrls, setAssetUrls] = useState<Record<string, string>>({});
  const maintenanceAttempt = useRef(0);
  const dataRef = useRef(data);
  dataRef.current = data;
  const profile = data.profiles?.find((p) => p.id === session?.user.id),
    admin = profile?.role === "admin";
  const rows = (t: string) => data[t] || [];
  const reload = async () => {
    if (!db) return;
    try {
      const next = Object.fromEntries(
        await Promise.all(tables.map(async (t) => [t, await read(t)])),
      );
      const me = next.profiles.find((p: Row) => p.id === session?.user.id);
      if (me?.role === "admin") {
        for (const t of [
          "invitations",
          "payment_verifications",
          "inventory_ledger",
          "credit_ledger",
          "administrator_audit_logs",
          "fulfillment_internal_notes",
        ])
          next[t] = await read(
            t,
            [
              "inventory_ledger",
              "credit_ledger",
              "administrator_audit_logs",
            ].includes(t)
              ? { limit: 100 }
              : undefined,
          );
      } else next.credit_ledger = await read("credit_ledger", { limit: 100 });
      try {
        const capabilities = await command("workspace_capabilities");
        setAccountControls(capabilities.account_controls === true);
        setAutoApprovalControls(capabilities.auto_approval === true);
        next.seller_billing = capabilities.account_controls
          ? await read("seller_billing")
          : [];
        if (
          me?.role === "admin" &&
          capabilities.data_retention &&
          Date.now() - maintenanceAttempt.current > 86400000
        ) {
          try {
            await command("maintain_workspace");
            maintenanceAttempt.current = Date.now();
          } catch {
            /* Retry during the next refresh; do not disable unrelated controls. */
          }
        }
        setOrderManagement(
          capabilities.order_management === true &&
            capabilities.credit_request_management === true,
        );
      } catch {
        setOrderManagement(false);
        setAccountControls(false);
        setAutoApprovalControls(false);
      }
      setData(next);
      const paths = [...next.product_images, ...next.listing_assets].map(
        (i: Row) => i.path,
      );
      if (paths.length) {
        const { data: urls, error: err } = await db.storage
          .from("product-assets")
          .createSignedUrls(paths, 3600);
        if (err) throw err;
        setAssetUrls(
          Object.fromEntries((urls || []).map((u) => [u.path, u.signedUrl])),
        );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (!db) return;
    db.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (!session) setLoading(false);
    });
    const {
      data: { subscription },
    } = db.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (
        event === "PASSWORD_RECOVERY" ||
        (event === "SIGNED_IN" && s?.user.user_metadata?.needs_password)
      )
        setRecovery(true);
      if (!s) {
        setData({});
        setLoading(false);
      }
    });
    return () => subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (session) {
      void reload();
      const timer = setInterval(() => void reload(), 60000);
      return () => clearInterval(timer);
    }
  }, [session]);
  useEffect(() => {
    const onHash = () => setPage(routeFromHash(location.hash));
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => {
    if (!profile) return;
    const allowed = (admin ? adminNav : sellerNav).map(([p]) => p) as string[];
    if (!allowed.includes(page)) {
      const next = admin ? "Overview" : "Dashboard";
      setPage(next);
      location.hash = next;
    }
  }, [profile?.role, page]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        const next = admin ? "Products" : "Browse Products";
        setPage(next);
        location.hash = next;
        requestAnimationFrame(() =>
          document
            .querySelector<HTMLInputElement>('[aria-label="Search products"]')
            ?.focus(),
        );
      }
    };
    addEventListener("keydown", handler);
    return () => removeEventListener("keydown", handler);
  }, [admin]);
  const menuButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!mobile) return;
    const drawer = document.getElementById("workspace-navigation");
    drawer?.querySelector<HTMLButtonElement>(".navigation-close")?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobile(false);
        menuButton.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [mobile]);
  const closeNavigation = () => {
    setMobile(false);
    menuButton.current?.focus();
  };
  const navigate = (p: string) => {
    setPage(p);
    location.hash = p;
    setSearch("");
    setCategory("All categories");
    setMobile(false);
  };
  const run = async (
    fn: () => Promise<unknown>,
    message = "Saved successfully",
  ) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
      setNotice(message);
      setModal(null);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const act = (a: string, p: Row, msg?: string) =>
    run(() => command(a, p), msg);
  const variant = (id: string) =>
    rows("product_variants").find((x) => x.id === id);
  const product = (id: string) => rows("products").find((x) => x.id === id);
  const productName = (id: string) => {
    const v = variant(id);
    return `${product(v?.product_id)?.name || "Product"}${v?.name && v.name !== "Default" ? " · " + v.name : ""}`;
  };
  const person = (id: string) =>
    rows("profiles").find((x) => x.id === id)?.email || id.slice(0, 8);
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setNotice("Copied to clipboard");
    } catch {
      setError(
        "Clipboard access was denied. Select and copy the text manually.",
      );
    }
  };
  const confirmAction = (title: string, a: string, p: Row, reason = false) =>
    setModal(
      <Modal title={title} close={() => setModal(null)}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void act(a, { ...p, ...Object.fromEntries(f) });
          }}
        >
          <p className="muted">
            Review this action before confirming. Every credit and inventory
            change is recorded.
          </p>
          {reason && (
            <Field label="Reason (optional)">
              <textarea name="reason" maxLength={2000} />
            </Field>
          )}
          <div className="form-actions">
            <button
              type="button"
              className="secondary"
              onClick={() => setModal(null)}
            >
              Go back
            </button>
            <button className="primary" type="submit">
              {title.replace(/\?$/, "")}
            </button>
          </div>
        </form>
      </Modal>,
    );
  const requestCredits = (v: Row) =>
    setModal(
      <Modal title="Request product credits" close={() => setModal(null)}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void act(
              "request_credit",
              {
                variant_id: v.id,
                quantity: Number(f.get("quantity")),
                notes: f.get("notes"),
              },
              "Request submitted. Follow the payment instructions in Credit Requests.",
            );
          }}
        >
          <p className="muted">
            {productName(v.id)} · {money(v.wholesale_cents)} per credit
          </p>
          <p className="info">
            {profile?.auto_approve_credits
              ? profile.payment_terms === "pay_later"
                ? "New requests can be approved automatically when stock is available. Payment remains due."
                : "New requests can be approved automatically after an administrator verifies your payment, subject to available stock."
              : "Your requests require administrator approval."}
          </p>
          <Field label="Number of credits">
            <input
              name="quantity"
              type="number"
              min="1"
              max="100000"
              defaultValue="1"
              required
              onChange={(e) => {
                const el = e.currentTarget.form?.querySelector("[data-total]");
                if (el)
                  el.textContent = money(
                    Number(e.target.value) * v.wholesale_cents,
                  );
              }}
            />
          </Field>
          <div className="total">
            Total to arrange offline{" "}
            <strong data-total>{money(v.wholesale_cents)}</strong>
          </div>
          <Field label="Notes (optional)">
            <textarea name="notes" maxLength={2000} />
          </Field>
          <div className="info">
            {rows("settings")[0]?.payment_instructions ||
              "Contact your administrator to arrange payment."}
            <br />
            {profile?.payment_terms === "pay_later"
              ? "Your account can pay later. Every request still needs administrator approval; approved credits remain payable until payment is verified."
              : "Your account pays upfront. Credits require verified payment and administrator approval."}
          </div>
          <button className="primary full" type="submit">
            Submit credit request <ArrowRight size={16} />
          </button>
        </form>
      </Modal>,
    );
  const downloadAsset = async (path: string, name: string) => {
    if (!db) return;
    try {
      const { data: blob, error: err } = await db.storage
        .from("product-assets")
        .download(path);
      if (err) throw err;
      downloadBlob(blob, name);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const downloadAll = async (p: Row) => {
    if (!db) return;
    setBusy(true);
    try {
      const zip = new JSZip();
      for (const [i, img] of rows("product_images")
        .filter((x) => x.product_id === p.id)
        .entries()) {
        const { data: blob, error: err } = await db.storage
          .from("product-assets")
          .download(img.path);
        if (err) throw err;
        zip.file(`${i + 1}.${img.path.split(".").pop()}`, blob);
      }
      downloadBlob(
        await zip.generateAsync({ type: "blob" }),
        `${p.name}-images.zip`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const showProduct = (p: Row) => {
    const vs = rows("product_variants").filter((v) => v.product_id === p.id);
    setModal(
      <Modal title={p.name} close={() => setModal(null)}>
        <div className="gallery">
          {rows("product_images")
            .filter((x) => x.product_id === p.id)
            .map((im, i) => (
              <button
                key={im.id}
                onClick={() =>
                  void downloadAsset(
                    im.path,
                    `${p.name}-${i + 1}.${im.path.split(".").pop()}`,
                  )
                }
                title="Download image"
              >
                <img src={assetUrls[im.path]} alt={`${p.name} ${i + 1}`} />
                <ArrowDownToLine size={16} />
              </button>
            ))}
        </div>
        <p>{p.description}</p>
        <div className="specs">
          <span>
            Condition <b>{p.condition}</b>
          </span>
          <span>
            Dimensions <b>{p.dimensions || "Not provided"}</b>
          </span>
          <span>
            Weight <b>{p.weight || "Not provided"}</b>
          </span>
        </div>
        <p className="prewrap">{p.specifications}</p>
        {vs.map((v) => (
          <div className="variant-row" key={v.id}>
            <div>
              <strong>{v.name}</strong>
              <p>
                {money(v.wholesale_cents)} wholesale · {money(v.resale_cents)}{" "}
                suggested resale
              </p>
              <small>
                {v.stock - v.committed} available ·{" "}
                {rows("credit_balances").find(
                  (b) =>
                    b.variant_id === v.id && b.seller_id === session?.user.id,
                )?.available || 0}{" "}
                of your credits
              </small>
            </div>
            <button className="primary" onClick={() => requestCredits(v)}>
              Request credits
            </button>
          </div>
        ))}
        <h3>Ready for your next listing</h3>
        <div className="button-row">
          <button
            className="secondary"
            onClick={() => void copy(p.listing_title || p.name)}
          >
            <Copy size={15} />
            Copy title
          </button>
          <button
            className="secondary"
            onClick={() => void copy(p.description)}
          >
            <Copy size={15} />
            Copy description
          </button>
          <button
            className="secondary"
            onClick={() => void copy(p.specifications)}
          >
            <Copy size={15} />
            Copy specs
          </button>
          <button className="secondary" onClick={() => void downloadAll(p)}>
            <ArrowDownToLine size={15} />
            All photos
          </button>
        </div>
        {rows("listing_assets")
          .filter((a) => a.product_id === p.id)
          .map((a) => (
            <button
              className="asset"
              key={a.id}
              onClick={() => void downloadAsset(a.path, a.name)}
            >
              <ArrowDownToLine size={16} />
              {a.name}
            </button>
          ))}
        <Profit
          cost={vs[0]?.wholesale_cents || 0}
          resale={vs[0]?.resale_cents || 0}
        />
      </Modal>,
    );
  };
  const editProduct = (p: Row = {}) =>
    setModal(
      <Modal
        title={p.id ? "Edit product" : "Create a product"}
        close={() => setModal(null)}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void act("save_product", {
              id: p.id || "",
              ...Object.fromEntries(new FormData(e.currentTarget)),
            });
          }}
        >
          {[
            ["name", "Product name"],
            ["category", "Category"],
            ["listing_title", "Listing title"],
            ["condition", "Condition"],
            ["dimensions", "Dimensions"],
            ["weight", "Weight"],
          ].map(([key, label]) => (
            <Field key={key} label={label}>
              <input
                name={key}
                defaultValue={p[key] || ""}
                required={key === "name"}
              />
            </Field>
          ))}
          {[
            ["description", "Description"],
            ["specifications", "Specifications"],
          ].map(([key, label]) => (
            <Field key={key} label={label}>
              <textarea name={key} defaultValue={p[key] || ""} />
            </Field>
          ))}
          <button className="primary full" type="submit">
            Save product
          </button>
        </form>
      </Modal>,
    );
  const editVariant = (v: Row = {}, productId?: string) =>
    setModal(
      <Modal
        title={v.id ? "Edit variant" : "Add product variant"}
        close={() => setModal(null)}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = Object.fromEntries(new FormData(e.currentTarget));
            void act("save_variant", {
              ...f,
              id: v.id || "",
              product_id: v.product_id || productId,
              wholesale_cents: Math.round(Number(f.wholesale) * 100),
              resale_cents: Math.round(Number(f.resale) * 100),
            });
          }}
        >
          {[
            ["name", "Variant name", v.name || "Default", "text"],
            ["sku", "SKU", v.sku || "", "text"],
            [
              "wholesale",
              "Wholesale price ($)",
              (v.wholesale_cents || 0) / 100,
              "number",
            ],
            [
              "resale",
              "Suggested resale price ($)",
              (v.resale_cents || 0) / 100,
              "number",
            ],
            ["low_stock", "Low stock threshold", v.low_stock ?? 5, "number"],
          ].map(([key, label, val, type]) => (
            <Field key={key} label={label as string}>
              <input
                name={key as string}
                type={type as string}
                defaultValue={val}
                min="0"
                step={type === "number" && key !== "low_stock" ? "0.01" : "1"}
                required
              />
            </Field>
          ))}
          <button className="primary full" type="submit">
            Save variant
          </button>
        </form>
      </Modal>,
    );
  const adjustment = (v: Row, seller?: string) =>
    setModal(
      <Modal
        title={seller ? "Adjust product credits" : "Adjust physical stock"}
        close={() => setModal(null)}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void act(seller ? "credit_adjust" : "stock_adjust", {
              variant_id: v.id,
              seller_id: seller,
              delta: Number(f.get("delta")),
              reason: f.get("reason"),
            });
          }}
        >
          <p>{productName(v.id)}</p>
          <Field label="Units to add or remove (use a negative number to remove)">
            <input name="delta" type="number" step="1" required />
          </Field>
          <Field label="Adjustment reason (optional)">
            <textarea name="reason" />
          </Field>
          <button className="primary full" type="submit">
            Record adjustment
          </button>
        </form>
      </Modal>,
    );
  const sellerOutstanding = (seller: string) =>
    rows("credit_requests")
      .filter((r) => r.seller_id === seller)
      .reduce((sum, r) => sum + amountOwed(r), 0) +
    (rows("seller_billing").find((b) => b.seller_id === seller)?.manual_cents ||
      0);
  const changeOutstanding = (seller: Row) => {
    const current = sellerOutstanding(seller.id);
    setModal(
      <Modal title="Change outstanding balance" close={() => setModal(null)}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void act("set_seller_outstanding", {
              seller_id: seller.id,
              amount_cents: Math.round(Number(f.get("amount")) * 100),
              expected_cents: current,
              reason: f.get("reason"),
            });
          }}
        >
          <p>{seller.email}</p>
          <p>
            Current outstanding: <strong>{money(current)}</strong>
          </p>
          <p>
            Enter the total this seller should owe. This records a balance
            adjustment; it does not record a payment or change product credits
            or stock.
          </p>
          <Field label="New outstanding balance ($)">
            <input
              type="number"
              name="amount"
              min="0"
              max="10000000"
              step="0.01"
              defaultValue={(current / 100).toFixed(2)}
              required
            />
          </Field>
          <Field label="Reason (optional)">
            <textarea name="reason" maxLength={2000} />
          </Field>
          <button className="primary full">Save outstanding balance</button>
        </form>
      </Modal>,
    );
  };
  const setStock = (v: Row) =>
    setModal(
      <Modal title="Set physical stock" close={() => setModal(null)}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void act("stock_set", {
              variant_id: v.id,
              stock: Number(f.get("stock")),
              reason: f.get("reason"),
            });
          }}
        >
          <p>{productName(v.id)}</p>
          <p>
            Current stock: {v.stock}. Committed: {v.committed}. Enter the total
            units physically on hand.
          </p>
          <Field label="New physical stock">
            <input
              name="stock"
              type="number"
              min={v.committed}
              step="1"
              defaultValue={v.stock}
              required
            />
          </Field>
          <Field label="Reason (optional)">
            <textarea name="reason" maxLength={2000} />
          </Field>
          <button className="primary full">Save stock count</button>
        </form>
      </Modal>,
    );
  const manageOrder = (o: Row) =>
    setModal(
      <Modal
        title={o.deleted_at ? "Restore order" : "Delete order"}
        close={() => setModal(null)}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void act(o.deleted_at ? "restore_order" : "delete_order", {
              id: o.id,
              reason: new FormData(e.currentTarget).get("reason"),
            });
          }}
        >
          <p>
            <strong>{o.reference}</strong>
          </p>
          <p>
            {o.deleted_at
              ? "Restoring returns this record to the order list. A canceled order stays canceled; submit a new label to fulfill it."
              : ["pending_review", "accepted", "packaging"].includes(o.status)
                ? "This cancels fulfillment and returns the units to the seller’s available credits. Physical stock and the seller’s stock commitment stay unchanged."
                : "This moves the record to Deleted orders. Shipment totals, stock, credits and payment records stay unchanged."}
          </p>
          <p>
            You can restore the record from Deleted orders. Its history and
            shipping labels are retained.
          </p>
          <Field label="Reason (optional)">
            <textarea name="reason" maxLength={2000} />
          </Field>
          <button className="primary full">
            {o.deleted_at ? "Restore order" : "Delete order"}
          </button>
        </form>
      </Modal>,
    );
  const viewOrder = (o: Row) =>
    setModal(
      <Modal title={o.reference} close={() => setModal(null)}>
        <Badge value={o.status} />
        <p>
          {o.marketplace} ·{" "}
          {o.marketplace_order_id || "No marketplace reference"}
        </p>
        <p className="prewrap">{o.notes}</p>
        {rows("fulfillment_items")
          .filter((i) => i.request_id === o.id)
          .map((i) => (
            <div className="variant-row" key={i.id}>
              {productName(i.variant_id)}
              <b>× {i.quantity}</b>
            </div>
          ))}
        {rows("shipping_labels")
          .filter((l) => l.request_id === o.id)
          .map((l) => (
            <button
              className="asset"
              key={l.id}
              onClick={() =>
                void run(async () => {
                  const url = await signedLabel(l.path);
                  window.open(url, "_blank", "noopener,noreferrer");
                }, "Label opened with a link that expires in two minutes.")
              }
            >
              <ArrowDownToLine size={16} />
              {l.name}
            </button>
          ))}
        {o.tracking && (
          <p>
            Tracking: <strong>{o.tracking}</strong>
          </p>
        )}
        <h3>Order timeline</h3>
        {o.deleted_at && (
          <p>
            Deleted {date(o.deleted_at)} · {o.deletion_reason}
          </p>
        )}
        {admin && (
          <button
            className="secondary"
            disabled={!orderManagement}
            onClick={() => manageOrder(o)}
          >
            {o.deleted_at ? "Restore order" : "Delete order"}
          </button>
        )}
        {rows("order_status_history")
          .filter((h) => h.request_id === o.id)
          .sort((a, b) => a.created_at.localeCompare(b.created_at))
          .map((h) => (
            <div className="timeline" key={h.id}>
              <Check size={15} />
              <div>
                <strong>{status(h.status)}</strong>
                <p>
                  {date(h.created_at)} {h.note && `· ${h.note}`}
                </p>
              </div>
            </div>
          ))}
        {admin && (
          <>
            <h3>Internal notes</h3>
            {rows("fulfillment_internal_notes")
              .filter((n) => n.request_id === o.id)
              .map((n) => (
                <p className="muted" key={n.id}>
                  {n.note} · {date(n.created_at)}
                </p>
              ))}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const note = new FormData(e.currentTarget).get("note");
                void run(async () => {
                  const { error: err } = await db!.rpc("add_internal_note", {
                    request: o.id,
                    note,
                  });
                  if (err) throw err;
                });
              }}
            >
              <Field label="Add internal note (administrators only)">
                <textarea name="note" required maxLength={4000} />
              </Field>
              <button className="secondary">Save internal note</button>
            </form>
          </>
        )}
        {admin &&
          !o.deleted_at &&
          ["pending_review", "accepted", "packaging", "shipped"].includes(
            o.status,
          ) && (
            <div className="button-row">
              {(o.status === "pending_review"
                ? ["accepted", "rejected"]
                : o.status === "accepted"
                  ? ["packaging", "shipped"]
                  : o.status === "packaging"
                    ? ["shipped"]
                    : ["completed"]
              ).map((st) => (
                <button
                  className="primary"
                  key={st}
                  onClick={() =>
                    st === "shipped"
                      ? setModal(
                          <Modal
                            title="Record shipment"
                            close={() => setModal(null)}
                          >
                            <form
                              onSubmit={(e) => {
                                e.preventDefault();
                                void act("fulfillment_status", {
                                  id: o.id,
                                  status: st,
                                  tracking: new FormData(e.currentTarget).get(
                                    "tracking",
                                  ),
                                });
                              }}
                            >
                              <Field label="Tracking number">
                                <input name="tracking" required />
                              </Field>
                              <p className="muted">
                                Recording shipment deducts physical inventory
                                exactly once.
                              </p>
                              <button className="primary full">
                                Confirm shipment
                              </button>
                            </form>
                          </Modal>,
                        )
                      : confirmAction(
                          `Mark ${status(st)}`,
                          "fulfillment_status",
                          { id: o.id, status: st },
                          st === "rejected",
                        )
                  }
                >
                  {
                    {
                      accepted: "Accept order",
                      rejected: "Reject order",
                      packaging: "Start packaging",
                      shipped: "Record shipment",
                      completed: "Mark completed",
                    }[st]
                  }
                </button>
              ))}
            </div>
          )}
        {!admin && !o.deleted_at && o.status === "pending_review" && (
          <button
            className="secondary"
            onClick={() =>
              confirmAction(
                "Cancel pending fulfillment?",
                "cancel_fulfillment",
                { id: o.id },
              )
            }
          >
            Cancel request & release credits
          </button>
        )}
      </Modal>,
    );
  const manageCreditRequest = (r: Row) =>
    setModal(
      <Modal
        title={
          r.deleted_at ? "Restore credit request" : "Delete credit request"
        }
        close={() => setModal(null)}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void act(
              r.deleted_at ? "restore_credit_request" : "delete_credit_request",
              { id: r.id, reason: new FormData(e.currentTarget).get("reason") },
            );
          }}
        >
          <p>
            {productName(r.variant_id)} · {r.quantity} credits ·{" "}
            {money(r.quantity * r.unit_cents)}
          </p>
          <p>
            {r.deleted_at
              ? "Restore this record to the active list to manage it."
              : "Move this record to Deleted requests. You can restore it later. Deleting does not remove issued credits, change stock, refund payments, or cancel an amount owed. Use Sellers → View history → Adjust to remove unused credits separately."}
          </p>
          {amountOwed(r) > 0 && (
            <p>
              Amount still owed: <strong>{money(amountOwed(r))}</strong>. This
              remains included in outstanding purchases even while deleted.
            </p>
          )}
          <Field label="Reason (optional)">
            <textarea name="reason" maxLength={2000} />
          </Field>
          <button className="primary full">
            {r.deleted_at ? "Restore credit request" : "Delete credit request"}
          </button>
        </form>
      </Modal>,
    );
  const verify = (r: Row) =>
    setModal(
      <Modal title="Verify offline payment" close={() => setModal(null)}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void act("verify_payment", {
              id: r.id,
              ...Object.fromEntries(new FormData(e.currentTarget)),
            });
          }}
        >
          <div className="total">
            {person(r.seller_id)}
            <strong>
              {money(
                r.status === "approved"
                  ? amountOwed(r)
                  : r.quantity * r.unit_cents,
              )}
            </strong>
          </div>
          <p className="muted">
            Confirm the full amount was received outside GPOP Fulfillment.
            Verification settles an already approved purchase without issuing
            additional credits; an unapproved request still needs separate
            approval.
          </p>
          <Field label="Payment method">
            <input name="method" required />
          </Field>
          <Field label="Payment received at">
            <input type="datetime-local" name="paid_at" required />
          </Field>
          <Field label="Internal payment notes">
            <textarea name="notes" />
          </Field>
          <button className="primary full">Confirm funds received</button>
        </form>
      </Modal>,
    );
  const invite = () =>
    setModal(
      <Modal title="Invite a seller" close={() => setModal(null)}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const email = new FormData(e.currentTarget).get("email");
            void run(async () => {
              const { error: err } = await db!.functions.invoke(
                invitationFunction,
                {
                  body: {
                    email,
                    redirectTo: location.origin + location.pathname,
                  },
                },
              );
              if (err) throw err;
            }, "Invitation email sent.");
          }}
        >
          <p className="muted">
            Single-use email invitation. Expires after{" "}
            {rows("settings")[0]?.invitation_hours || 24} hours.
          </p>
          <Field label="Seller email">
            <input name="email" type="email" required />
          </Field>
          <button className="primary full">Send invitation</button>
        </form>
      </Modal>,
    );

  const visibleProducts = rows("products")
    .filter(
      (p) =>
        (admin || !p.archived) &&
        `${p.name} ${p.category}`
          .toLowerCase()
          .includes(search.toLowerCase()) &&
        (category === "All categories" || p.category === category),
    )
    .sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name)
        : sort === "price"
          ? Math.min(
              ...rows("product_variants")
                .filter((v) => v.product_id === a.id)
                .map((v) => v.wholesale_cents),
            ) -
            Math.min(
              ...rows("product_variants")
                .filter((v) => v.product_id === b.id)
                .map((v) => v.wholesale_cents),
            )
          : b.created_at.localeCompare(a.created_at),
    );
  const balanceRows = rows("credit_balances").filter(
    (b) => b.seller_id === session?.user.id,
  );
  const outstanding = rows("fulfillment_requests").filter((o) =>
    ["pending_review", "accepted", "packaging"].includes(o.status),
  );
  const unread = rows("notifications").filter((n) => !n.read_at).length;
  const catalog = (
    <>
      <div className="toolbar">
        <div className="search">
          <Search size={17} />
          <input
            aria-label="Search products"
            placeholder="Search products, categories…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <kbd>Ctrl K</kbd>
        </div>
        <select
          aria-label="Category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option>All categories</option>
          {[...new Set(rows("products").map((p) => p.category))].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <SlidersHorizontal size={17} />
        <select
          aria-label="Sort products"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          <option value="newest">Newest first</option>
          <option value="name">Name A–Z</option>
          <option value="price">Price: low to high</option>
        </select>
        <span className="view-icon">
          <Grid2X2 size={18} />
        </span>
      </div>
      <p className="results">
        {visibleProducts.length} products{" "}
        <span>Handpicked. Ready to list.</span>
      </p>
      {!visibleProducts.length ? (
        <Empty
          title={
            configured
              ? "Your next bestseller starts here"
              : "Your catalog is ready to connect"
          }
        >
          {configured
            ? "Products added by your administrator will appear here."
            : "Connect your Supabase project to load your private product catalog."}
        </Empty>
      ) : (
        <div className="product-grid">
          {visibleProducts.map((p, i) => {
            const v = rows("product_variants")
              .filter((x) => x.product_id === p.id)
              .sort((a, b) => a.wholesale_cents - b.wholesale_cents)[0];
            const img = rows("product_images").find(
              (x) => x.product_id === p.id,
            );
            return (
              <motion.article
                className="product-card"
                key={p.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.035 }}
              >
                <button
                  className="product-image"
                  aria-label={`View ${p.name} details`}
                  onClick={() => showProduct(p)}
                >
                  {img ? (
                    <img src={assetUrls[img.path]} alt={p.name} />
                  ) : (
                    <Package size={52} strokeWidth={1} />
                  )}
                  <span className="image-tag">{p.category}</span>
                  {p.archived && <span className="archived">Archived</span>}
                </button>
                <div className="product-body">
                  <h3>{p.name}</h3>
                  <p className="product-meta">
                    {p.condition} ·{" "}
                    {v
                      ? `${v.stock - v.committed} units available`
                      : "No variants"}
                  </p>
                  {v && (
                    <>
                      <div className="price-line">
                        <span>Wholesale</span>
                        <strong>{money(v.wholesale_cents)}</strong>
                      </div>
                      <div className="price-line">
                        <span>Suggested resale</span>
                        <span>{money(v.resale_cents)}</span>
                      </div>
                      <div className="profit-line">
                        <span>Est. gross profit</span>
                        <strong>
                          +{money(v.resale_cents - v.wholesale_cents)}{" "}
                          <ArrowUpRight size={13} />
                        </strong>
                      </div>
                    </>
                  )}
                  <button
                    className="details-button"
                    onClick={() => showProduct(p)}
                  >
                    View product <ArrowRight size={16} />
                  </button>
                  {admin && (
                    <div className="admin-card-actions">
                      <button onClick={() => editProduct(p)}>
                        Edit product
                      </button>
                      <button onClick={() => editVariant({}, p.id)}>
                        Add variant
                      </button>
                      <button
                        onClick={() =>
                          confirmAction(
                            p.archived
                              ? "Restore product?"
                              : "Archive product?",
                            "archive_product",
                            { id: p.id, archived: !p.archived },
                          )
                        }
                      >
                        {p.archived ? "Restore" : "Archive"}
                      </button>
                      <label className="upload-link">
                        Add photo
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f)
                              void run(async () =>
                                command("add_image", {
                                  product_id: p.id,
                                  path: await upload("product-assets", f),
                                }),
                              );
                          }}
                        />
                      </label>
                      <label className="upload-link">
                        Listing asset
                        <input
                          type="file"
                          accept="application/pdf,image/png,image/jpeg,image/webp"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f)
                              void run(async () =>
                                command("add_asset", {
                                  product_id: p.id,
                                  path: await upload("product-assets", f),
                                  name: f.name,
                                }),
                              );
                          }}
                        />
                      </label>
                    </div>
                  )}
                </div>
              </motion.article>
            );
          })}
        </div>
      )}
      <div className="catalog-foot">
        <ShieldCheck size={16} /> Curated products. Reliable fulfillment. Your
        business, backed by us.
        <span>Profit estimates exclude marketplace fees and shipping.</span>
      </div>
    </>
  );

  const billingManualTotal = rows("seller_billing").reduce(
    (sum, b) => sum + b.manual_cents,
    0,
  );
  const automaticApproval = (seller: Row) =>
    setModal(
      <Modal title="Automatic credit approval" close={() => setModal(null)}>
        <SellerAutoApproval
          seller={seller}
          onSave={(payload) =>
            void act(
              "set_seller_auto_approval",
              payload,
              "Automatic approval setting saved.",
            )
          }
        />
      </Modal>,
    );
  const requests = (
    <div className="panel">
      <div className="panel-heading">
        <div>
          <h3>
            {admin && showDeletedCredits
              ? "Deleted credit requests"
              : page === "Payment Verification"
                ? "Offline payment queue"
                : "Credit requests"}
          </h3>
          {admin && (
            <button
              className="secondary"
              onClick={() => setShowDeletedCredits(!showDeletedCredits)}
            >
              {showDeletedCredits ? "Active requests" : "Deleted requests"}
            </button>
          )}
          <p>
            Credit requests follow each seller’s approval setting. Pay-upfront
            sellers must pay first; permitted pay-later sellers can be approved
            before payment.
          </p>
        </div>
      </div>
      <div className="total" style={{ padding: "15px 23px" }}>
        Total outstanding balance (including deleted requests){" "}
        <strong>
          {money(
            rows("credit_requests").reduce(
              (total, r) => total + amountOwed(r),
              billingManualTotal,
            ),
          )}
        </strong>
      </div>
      {admin && !orderManagement && (
        <p className="muted">
          Deleting and restoring requests needs the order-management database
          update.
        </p>
      )}
      <div className="info">
        {billingManualTotal > 0 && (
          <p>
            Includes {money(billingManualTotal)} in manual balances. An
            administrator can change these under Sellers → Change balance.
          </p>
        )}
        {rows("settings")[0]?.payment_instructions ||
          "Connect Supabase to load your payment instructions."}
      </div>
      {!rows("credit_requests").filter((r) =>
        admin && showDeletedCredits ? !!r.deleted_at : !r.deleted_at,
      ).length ? (
        <Empty
          icon={Wallet}
          title={
            admin && showDeletedCredits
              ? "No deleted credit requests"
              : "No credit requests yet"
          }
        >
          {admin && showDeletedCredits
            ? "Deleted requests can be restored here."
            : "Browse products to request your first product credits."}
        </Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Product / seller</th>
                <th>Quantity</th>
                <th>Total</th>
                <th>Requested</th>
                <th>Approval / payment</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows("credit_requests")
                .filter((r) =>
                  admin && showDeletedCredits ? !!r.deleted_at : !r.deleted_at,
                )
                .filter(
                  (r) =>
                    showDeletedCredits ||
                    page !== "Payment Verification" ||
                    ["payment_reported", "under_review"].includes(r.status) ||
                    (r.status === "approved" &&
                      amountOwed(r) > 0 &&
                      r.payment_terms === "pay_later" &&
                      paymentStatus(r) !== "verified"),
                )
                .sort((a, b) => b.created_at.localeCompare(a.created_at))
                .map((r) => {
                  const verified =
                    paymentStatus(r) === "verified" ||
                    rows("payment_verifications").some(
                      (v) => v.request_id === r.id,
                    );
                  return (
                    <tr key={r.id}>
                      <td>
                        <strong>{productName(r.variant_id)}</strong>
                        <small>
                          {admin
                            ? person(r.seller_id)
                            : money(r.unit_cents) + " per credit"}
                        </small>
                        {r.notes && <small>{r.notes}</small>}
                        {r.decision_reason && (
                          <small>{r.decision_reason}</small>
                        )}
                      </td>
                      <td>{r.quantity}</td>
                      <td>
                        {money(r.unit_cents * r.quantity)}
                        {r.status === "approved" && (
                          <small>Outstanding: {money(amountOwed(r))}</small>
                        )}
                      </td>
                      <td>{date(r.created_at)}</td>
                      <td>
                        <Badge value={r.status} />
                        {r.deleted_at && (
                          <small>
                            Deleted {date(r.deleted_at)} · {r.deletion_reason}
                          </small>
                        )}
                        <small>
                          {r.payment_terms === "pay_later"
                            ? "Pay later"
                            : "Pay upfront"}{" "}
                          ·{" "}
                          {verified
                            ? "Payment verified"
                            : paymentStatus(r) === "reported"
                              ? "Payment reported"
                              : "Unpaid"}
                        </small>
                      </td>
                      <td>
                        {!r.deleted_at && (
                          <CreditRequestActions
                            request={r}
                            admin={admin}
                            verified={verified}
                            payLaterAllowed={
                              rows("profiles").find((p) => p.id === r.seller_id)
                                ?.payment_terms === "pay_later"
                            }
                            confirm={confirmAction}
                            verify={verify}
                          />
                        )}
                        {admin && (
                          <button
                            className="secondary small"
                            disabled={!orderManagement}
                            onClick={() => manageCreditRequest(r)}
                          >
                            {r.deleted_at
                              ? "Restore request"
                              : "Delete request"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
  const orders = (
    <div className="panel">
      <div className="panel-heading">
        <h3>
          {showDeleted
            ? "Deleted orders"
            : admin
              ? "Fulfillment queue"
              : "Your orders"}
        </h3>
        {admin && (
          <button
            className="secondary"
            onClick={() => setShowDeleted(!showDeleted)}
          >
            {showDeleted ? "Active orders" : "Deleted orders"}
          </button>
        )}
        <div className="search">
          <Search size={16} />
          <input
            aria-label="Search orders"
            placeholder="Search reference, marketplace or status"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>
      {admin && !orderManagement && (
        <p className="muted">
          Order deletion and Set stock need the order-management database
          update. Existing stock adjustments work now.
        </p>
      )}
      {!rows("fulfillment_requests").filter((o) =>
        showDeleted ? !!o.deleted_at : !o.deleted_at,
      ).length ? (
        <Empty
          icon={Truck}
          title={
            showDeleted ? "No deleted orders" : "Your first shipment is next"
          }
        >
          {showDeleted
            ? "Orders you delete can be restored here."
            : "Submitted shipping labels and fulfillment updates will appear here."}
        </Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Order</th>
                {admin && <th>Seller</th>}
                <th>Marketplace</th>
                <th>Submitted</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows("fulfillment_requests")
                .filter((o) => (showDeleted ? !!o.deleted_at : !o.deleted_at))
                .filter((o) =>
                  `${o.reference} ${o.marketplace} ${o.status}`
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                )
                .sort((a, b) => b.created_at.localeCompare(a.created_at))
                .map((o) => (
                  <tr key={o.id}>
                    <td>
                      <strong>{o.reference}</strong>
                      <small>{o.marketplace_order_id}</small>
                    </td>
                    {admin && <td>{person(o.seller_id)}</td>}
                    <td>{o.marketplace}</td>
                    <td>{date(o.created_at)}</td>
                    <td>
                      <Badge value={o.status} />
                    </td>
                    <td>
                      <button
                        className="secondary small"
                        onClick={() => viewOrder(o)}
                      >
                        View order <ChevronRight size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
  let content: ReactNode;
  if (["Browse Products", "Products"].includes(page)) content = catalog;
  else if (["Dashboard", "Overview"].includes(page))
    content = (
      <>
        <div className="welcome">
          <div className="welcome-copy">
            <span className="eyebrow">YOUR BUSINESS. OUR BACKING.</span>
            <h2>
              Good products.
              <br />
              Great possibilities.
            </h2>
            <p>Find your next bestseller. We’ll handle the fulfillment.</p>
            <button
              className="white-button"
              onClick={() => navigate(admin ? "Products" : "Browse Products")}
            >
              Explore the catalog <ArrowRight size={16} />
            </button>
          </div>
          <div className="welcome-art" aria-hidden="true">
            <div className="orbit o1" />
            <div className="orbit o2" />
            <div className="parcel">
              <BrandMark />
            </div>
            <div className="floating-check">
              <Check size={19} />
              Ready to ship
            </div>
          </div>
        </div>
        <div className="stats">
          {(admin
            ? [
                [
                  rows("profiles").filter(
                    (p) => p.role === "seller" && !p.suspended,
                  ).length,
                  "Active sellers",
                  Users,
                ],
                [
                  rows("credit_requests").filter(
                    (r) => paymentStatus(r) === "reported",
                  ).length,
                  "Payments to verify",
                  Wallet,
                ],
                [outstanding.length, "Open fulfillments", Truck],
                [
                  rows("product_variants").filter(
                    (v) => v.stock - v.committed <= v.low_stock,
                  ).length,
                  "Low stock variants",
                  Box,
                ],
                [
                  rows("invitations").filter(
                    (i) =>
                      !i.accepted_at && new Date(i.expires_at) > new Date(),
                  ).length,
                  "Pending invitations",
                  Users,
                ],
                [
                  rows("credit_requests").filter((r) =>
                    [
                      "pending_payment",
                      "payment_reported",
                      "under_review",
                    ].includes(r.status),
                  ).length,
                  "Pending credit requests",
                  ClipboardList,
                ],
                [
                  rows("credit_balances").reduce(
                    (total, b) => total + b.issued,
                    0,
                  ),
                  "Credits issued",
                  Coins,
                ],
                [
                  rows("fulfillment_requests").filter((o) =>
                    ["shipped", "completed"].includes(o.status),
                  ).length,
                  "Orders shipped",
                  Truck,
                ],
              ]
            : [
                [
                  balanceRows.reduce((s, b) => s + b.available, 0),
                  "Available credits",
                  Coins,
                ],
                [
                  balanceRows.reduce((s, b) => s + b.reserved, 0),
                  "Reserved credits",
                  Box,
                ],
                [outstanding.length, "Orders in progress", Truck],
                [
                  rows("fulfillment_requests").filter((o) =>
                    ["shipped", "completed"].includes(o.status),
                  ).length,
                  "Orders shipped",
                  Check,
                ],
              ]
          ).map(([n, label, Icon]) => {
            const I = Icon as typeof Package;
            return (
              <div className="stat" key={label as string}>
                <div className="stat-label">
                  {label as string}
                  <I size={18} />
                </div>
                <strong>{configured ? (n as number) : "—"}</strong>
                <span>
                  {configured
                    ? "Your workspace, up to date"
                    : "Available after connection"}
                </span>
              </div>
            );
          })}
        </div>
        <div className="dashboard-columns">
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h3>A little prep. A lot of potential.</h3>
                <p>Your path from product to doorstep.</p>
              </div>
              <span className="tiny-tag">THE GPOP WAY</span>
            </div>
            {[
              [
                "01",
                "Find your product",
                "Explore the catalog and download ready-to-use listing materials.",
                admin ? "Products" : "Browse Products",
              ],
              [
                "02",
                "Get your credits",
                "Request product credits and arrange payment with your administrator.",
                "Credit Requests",
              ],
              [
                "03",
                "Make a sale. Send a label.",
                "Upload your prepaid label. We pack it, ship it, and keep you updated.",
                admin ? "Fulfillment" : "Submit Shipping Label",
              ],
            ].map(([n, title, desc, to]) => (
              <button className="step-row" key={n} onClick={() => navigate(to)}>
                <span className="step-number">{n}</span>
                <div>
                  <strong>{title}</strong>
                  <p>{desc}</p>
                </div>
                <ChevronRight size={17} />
              </button>
            ))}
          </section>
          <section className="panel activity-panel">
            <div className="panel-heading">
              <h3>Latest activity</h3>
              <button
                onClick={() => navigate(admin ? "Activity Logs" : "Activity")}
              >
                View all activity <ArrowUpRight size={14} />
              </button>
            </div>
            {rows("notifications")
              .slice()
              .sort((a, b) => b.created_at.localeCompare(a.created_at))
              .slice(0, 4)
              .map((n) => (
                <div className="activity-row" key={n.id}>
                  <div className="activity-dot" />
                  <div>
                    <p>{n.message}</p>
                    <small>{date(n.created_at)}</small>
                  </div>
                </div>
              ))}
            {!rows("notifications").length && (
              <Empty icon={History} title="A fresh start">
                Your workspace activity will appear here.
              </Empty>
            )}
          </section>
        </div>
        <div className="help-strip">
          <div className="help-icon">
            <HelpCircle size={22} />
          </div>
          <div>
            <strong>A partner in every order.</strong>
            <p>
              Questions about credits, products, or shipping? Your administrator
              is here to help.
            </p>
          </div>
          <button className="secondary" onClick={() => navigate("Settings")}>
            Workspace details <ArrowUpRight size={15} />
          </button>
        </div>
      </>
    );
  else if (["Credit Requests", "Payment Verification"].includes(page))
    content = requests;
  else if (["My Orders", "Fulfillment"].includes(page)) content = orders;
  else if (page === "My Credits")
    content = (
      <>
        <div className="toolbar">
          <div className="search">
            <Search size={17} />
            <input
              placeholder="Search your credits…"
              aria-label="Search your credits"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        {!balanceRows.length ? (
          <div className="panel">
            <Empty icon={Coins} title="Build your product portfolio">
              Approved product credits will appear here. Credits never expire.
            </Empty>
          </div>
        ) : (
          <div className="credit-grid">
            {balanceRows
              .filter((b) =>
                productName(b.variant_id)
                  .toLowerCase()
                  .includes(search.toLowerCase()),
              )
              .map((b) => (
                <div className="panel credit-card" key={b.variant_id}>
                  <Package />
                  <h3>{productName(b.variant_id)}</h3>
                  <p>
                    {money(variant(b.variant_id)?.wholesale_cents || 0)} per
                    credit
                  </p>
                  <div className="credit-numbers">
                    <span>
                      <strong>{b.available}</strong>Available
                    </span>
                    <span>
                      <strong>{b.reserved}</strong>Reserved
                    </span>
                    <span>
                      <strong>{b.consumed}</strong>Used
                    </span>
                  </div>
                  <div className="button-row">
                    <button
                      className="secondary"
                      onClick={() => requestCredits(variant(b.variant_id)!)}
                    >
                      Request more
                    </button>
                    <button
                      className="primary"
                      disabled={!b.available}
                      onClick={() => navigate("Submit Shipping Label")}
                    >
                      Submit label
                    </button>
                  </div>
                </div>
              ))}
          </div>
        )}
      </>
    );
  else if (page === "Submit Shipping Label")
    content = (
      <FulfillmentForm
        balances={balanceRows}
        variants={rows("product_variants")}
        productName={productName}
        onSubmit={async (p) => {
          const res = await command("submit_fulfillment", p);
          await reload();
          const list = await read("fulfillment_requests");
          setNotice(
            `Fulfillment submitted: ${list.find((o) => o.id === res.id)?.reference || res.id}`,
          );
          navigate("My Orders");
        }}
      />
    );
  else if (page === "Inventory")
    content = (
      <div className="panel">
        <div className="panel-heading">
          <h3>Physical stock & commitments</h3>
          <p>
            Use Adjust stock to add or remove units, or Set stock to enter the
            exact physical count. Stock cannot fall below committed credits.
          </p>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Product / SKU</th>
                <th>On hand</th>
                <th>Committed</th>
                <th>Reserved</th>
                <th>Shipped</th>
                <th>Uncommitted</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows("product_variants").map((v) => (
                <tr key={v.id}>
                  <td>
                    <strong>{productName(v.id)}</strong>
                    <small>{v.sku}</small>
                  </td>
                  <td>{v.stock}</td>
                  <td>{v.committed}</td>
                  <td>
                    {rows("credit_balances")
                      .filter((b) => b.variant_id === v.id)
                      .reduce((s, b) => s + b.reserved, 0)}
                  </td>
                  <td>{v.shipped}</td>
                  <td>{v.stock - v.committed}</td>
                  <td>
                    <div className="table-actions">
                      <button onClick={() => adjustment(v)}>
                        Adjust stock
                      </button>
                      <button
                        disabled={!orderManagement}
                        onClick={() => setStock(v)}
                      >
                        Set stock
                      </button>
                      <button onClick={() => editVariant(v)}>
                        Edit variant
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows("product_variants").length && (
          <Empty title="Add your first product variant">
            Inventory is tracked independently for each variant.
          </Empty>
        )}
      </div>
    );
  else if (page === "Sellers")
    content = (
      <div className="panel">
        <div className="panel-heading">
          <h3>People in your private beta</h3>
          {!autoApprovalControls && (
            <p className="muted">
              Auto-approval needs the auto-approval database update.
            </p>
          )}
          {!accountControls && (
            <p className="muted">
              Optional reasons and balance editing need the account-controls
              database update.
            </p>
          )}
          <button className="primary" onClick={invite}>
            <Plus size={16} />
            Invite seller
          </button>
        </div>
        {profile && typeof profile.payment_terms !== "string" && (
          <div className="info">
            Pay-upfront remains active. Install the payment-terms database
            update before enabling pay-later permissions.
          </div>
        )}
        {rows("profiles")
          .filter((p) => p.role === "seller")
          .map((p) => (
            <div className="seller-row" key={p.id}>
              <div>
                <strong>{p.name || p.email}</strong>
                <p>{p.email}</p>
                <Badge value={p.suspended ? "suspended" : "active"} />
                <p>
                  {p.payment_terms === "pay_later"
                    ? "Pay later permitted"
                    : "Pay upfront required"}{" "}
                  · {money(sellerOutstanding(p.id))} outstanding
                </p>
                <small>
                  {p.auto_approve_credits
                    ? "Automatic approval on for new requests"
                    : "Manual credit approval"}
                </small>
              </div>
              <div className="button-row">
                <button
                  className="secondary"
                  disabled={!accountControls}
                  onClick={() => changeOutstanding(p)}
                >
                  Change balance
                </button>
                <button
                  className="secondary"
                  disabled={!autoApprovalControls}
                  onClick={() => automaticApproval(p)}
                >
                  Auto-approve credits
                </button>
                <button
                  className="secondary"
                  disabled={typeof p.payment_terms !== "string"}
                  title={
                    typeof p.payment_terms !== "string"
                      ? "Apply the payment-terms database update first"
                      : undefined
                  }
                  onClick={() =>
                    setModal(
                      <Modal
                        title="Seller payment permission"
                        close={() => setModal(null)}
                      >
                        <SellerPaymentTerms
                          seller={p}
                          onSave={(payload) =>
                            void act(
                              "set_seller_terms",
                              payload,
                              "Payment permission updated.",
                            )
                          }
                        />
                      </Modal>,
                    )
                  }
                >
                  Payment terms
                </button>
                <button
                  className="secondary"
                  onClick={() =>
                    setModal(
                      <Modal
                        title={`${p.email} · account history`}
                        close={() => setModal(null)}
                      >
                        <h3>Product credits</h3>
                        {rows("credit_balances")
                          .filter((b) => b.seller_id === p.id)
                          .map((b) => (
                            <div className="variant-row" key={b.variant_id}>
                              <div>
                                {productName(b.variant_id)}
                                <small>
                                  {b.available} available · {b.reserved}{" "}
                                  reserved · {b.consumed} used
                                </small>
                              </div>
                              <button
                                className="secondary"
                                onClick={() =>
                                  adjustment(variant(b.variant_id)!, p.id)
                                }
                              >
                                Adjust credits
                              </button>
                            </div>
                          ))}
                        <Field label="Adjust another product">
                          <select
                            defaultValue=""
                            onChange={(e) => {
                              if (e.target.value)
                                adjustment(variant(e.target.value)!, p.id);
                            }}
                          >
                            <option value="">Select a product</option>
                            {rows("product_variants").map((v) => (
                              <option key={v.id} value={v.id}>
                                {productName(v.id)}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <h3>Credit requests</h3>
                        {rows("credit_requests")
                          .filter((r) => r.seller_id === p.id)
                          .map((r) => (
                            <div className="variant-row" key={r.id}>
                              <span>
                                {productName(r.variant_id)} × {r.quantity}
                              </span>
                              <Badge value={r.status} />
                            </div>
                          ))}
                        <h3>Fulfillment history</h3>
                        {rows("fulfillment_requests")
                          .filter((o) => o.seller_id === p.id)
                          .map((o) => (
                            <button
                              className="asset"
                              key={o.id}
                              onClick={() => viewOrder(o)}
                            >
                              {o.reference}
                              <Badge value={o.status} />
                            </button>
                          ))}
                      </Modal>,
                    )
                  }
                >
                  View history
                </button>
                <button
                  onClick={() =>
                    confirmAction(
                      p.suspended
                        ? "Restore seller access?"
                        : "Suspend seller access?",
                      "suspend_seller",
                      { id: p.id, suspended: !p.suspended },
                      true,
                    )
                  }
                >
                  {p.suspended
                    ? "Restore seller access"
                    : "Suspend seller access"}
                </button>
              </div>
            </div>
          ))}
        <h3 className="inset-title">Invitations</h3>
        {rows("invitations").map((i) => (
          <div className="seller-row" key={i.id}>
            <span>
              {i.email}
              <small>Expires {new Date(i.expires_at).toLocaleString()}</small>
            </span>
            <Badge
              value={
                i.accepted_at
                  ? "accepted"
                  : new Date(i.expires_at) < new Date()
                    ? "expired"
                    : "pending"
              }
            />
          </div>
        ))}
        {!rows("profiles").some((p) => p.role === "seller") && (
          <Empty icon={Users} title="Your team starts with an invitation">
            Invite your first seller to join the private beta.
          </Empty>
        )}
      </div>
    );
  else if (page === "Settings")
    content = (
      <div className="settings-grid">
        {import.meta.env.DEV && admin && <LabelStorageCheck />}
        <section className="panel padded">
          <h3>Profile</h3>
          <p className="muted">
            {profile?.email || "Connect Supabase to activate your workspace."}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void act("save_profile", {
                name: new FormData(e.currentTarget).get("name"),
              });
            }}
          >
            <Field label="Display name">
              <input
                name="name"
                defaultValue={profile?.name || ""}
                maxLength={160}
              />
            </Field>
            <button className="primary" disabled={!session}>
              Save profile
            </button>
          </form>
          <h3 className="spaced">Password</h3>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const password = new FormData(e.currentTarget).get(
                "password",
              ) as string;
              void run(async () => {
                const { error: err } = await db!.auth.updateUser({ password });
                if (err) throw err;
              }, "Password updated.");
            }}
          >
            <Field label="New password">
              <input
                name="password"
                type="password"
                minLength={12}
                required
                autoComplete="new-password"
              />
            </Field>
            <button className="secondary" disabled={!session}>
              Update password
            </button>
          </form>
        </section>
        <section className="panel padded">
          <h3>Workspace details</h3>
          {admin && (
            <div className="info">
              <strong>Data housekeeping</strong>
              <p>
                When enabled by the database update, cleanup runs at most once
                daily while an administrator uses the app. Read notifications
                are removed after 30 days; unread notifications and unused
                expired invitations after 90 days. Orders, payments, credit and
                stock history remain recorded. Activity ledgers load only the
                latest 100 records.
              </p>
            </div>
          )}
          {!admin && (
            <div className="info">
              <strong>
                {profile?.payment_terms === "pay_later"
                  ? "Pay later permitted"
                  : "Pay upfront required"}
              </strong>
              <br />
              {profile?.payment_terms === "pay_later"
                ? "Your administrator can approve product credits before payment. Each request still requires approval, and approved unpaid purchases remain due."
                : "Pay outside the app first. Your administrator verifies payment and approves the credits."}
            </div>
          )}
          <p className="muted">
            Payments happen outside GPOP Fulfillment. Contact the person who
            invited you for payment or order support.
          </p>
          {admin ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void act(
                  "save_settings",
                  Object.fromEntries(new FormData(e.currentTarget)),
                );
              }}
            >
              <Field label="Payment instructions shown to sellers">
                <textarea
                  name="payment_instructions"
                  defaultValue={rows("settings")[0]?.payment_instructions}
                  required
                />
              </Field>
              <Field label="Invitation expiration (hours)">
                <input
                  name="invitation_hours"
                  type="number"
                  min="1"
                  max="168"
                  defaultValue={rows("settings")[0]?.invitation_hours || 24}
                  required
                />
              </Field>
              <button className="primary">Save workspace settings</button>
            </form>
          ) : (
            <div className="info">
              {rows("settings")[0]?.payment_instructions ||
                "Your payment instructions will appear after connection."}
            </div>
          )}
          <div className="security-note">
            <ShieldCheck size={20} />
            <p>
              Product credits never expire. Private shipping labels use expiring
              download links.
            </p>
          </div>
        </section>
      </div>
    );
  else
    content = (
      <div className="panel">
        <div className="panel-heading">
          <h3>Notifications & account activity</h3>
        </div>
        {rows("notifications")
          .slice()
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
          .map((n) => (
            <div className="notification-row" key={n.id}>
              <span className={n.read_at ? "read-dot" : "activity-dot"} />
              <div>
                <p>{n.message}</p>
                <small>{new Date(n.created_at).toLocaleString()}</small>
              </div>
              {!n.read_at && (
                <button
                  onClick={() =>
                    void act(
                      "read_notification",
                      { id: n.id },
                      "Marked as read",
                    )
                  }
                >
                  Mark read
                </button>
              )}
            </div>
          ))}
        {!rows("notifications").length && (
          <Empty icon={Bell} title="You're all caught up">
            Notifications will appear as your business gets moving.
          </Empty>
        )}
        <p className="muted">
          Activity ledgers show the latest 100 records each. Older financial and
          stock records are retained.
        </p>
        <h3 className="inset-title">Credit ledger</h3>
        {rows("credit_ledger")
          .slice()
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
          .map((l) => (
            <div className="ledger-row" key={l.id}>
              <span>
                <strong>
                  {status(l.event)} · {productName(l.variant_id)}
                </strong>
                <small>
                  {l.reason} · {date(l.created_at)}
                </small>
              </span>
              <span>
                Available {l.available_delta > 0 ? "+" : ""}
                {l.available_delta} · Reserved {l.reserved_delta} · Used{" "}
                {l.consumed_delta}
              </span>
            </div>
          ))}
        {admin && (
          <>
            <h3 className="inset-title">Administrator audit</h3>
            {rows("administrator_audit_logs").map((l) => (
              <div className="ledger-row" key={l.id}>
                <span>
                  {status(l.action)} · {person(l.actor_id)}
                  <small>{l.details?.reason}</small>
                  {l.action === "set_seller_outstanding" && (
                    <small>
                      {money(l.details.old_outstanding_cents)} →{" "}
                      {money(l.details.new_outstanding_cents)}
                    </small>
                  )}
                </span>
                <small>{new Date(l.created_at).toLocaleString()}</small>
              </div>
            ))}
            <h3 className="inset-title">Inventory ledger</h3>
            {rows("inventory_ledger").map((l) => (
              <div className="ledger-row" key={l.id}>
                <span>
                  {productName(l.variant_id)} · {l.reason}
                  <small>{date(l.created_at)}</small>
                </span>
                <span>
                  Stock {l.stock_delta} · Commitment {l.commitment_delta}
                </span>
              </div>
            ))}
          </>
        )}
      </div>
    );
  if (configured && !session && !loading)
    return <Auth onError={setError} error={error} />;
  if (recovery && session)
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <h2>Set your password</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const password = new FormData(e.currentTarget).get(
                "password",
              ) as string;
              void run(async () => {
                const { error: err } = await db!.auth.updateUser({
                  password,
                  data: { needs_password: false },
                });
                if (err) throw err;
                setRecovery(false);
              });
            }}
          >
            <Field label="Password (at least 12 characters)">
              <input
                name="password"
                type="password"
                minLength={12}
                required
                autoComplete="new-password"
              />
            </Field>
            <button className="primary full">Save password</button>
          </form>
          {error && <p role="alert">{error}</p>}
        </div>
      </div>
    );
  const nav = admin ? adminNav : sellerNav;
  const mobileTabs = admin
    ? [
        ["Overview", "Home", LayoutDashboard],
        ["Inventory", "Stock", Box],
        ["Sellers", "Sellers", Users],
        ["Fulfillment", "Fulfillment", Truck],
      ] as const
    : [
        ["Dashboard", "Home", LayoutDashboard],
        ["Browse Products", "Catalog", ShoppingBag],
        ["My Credits", "Credits", Coins],
        ["My Orders", "Orders", Truck],
      ] as const;
  const descriptions: Record<string, string> = {
    Dashboard: "Everything you need to keep your business moving.",
    Overview: "A clear view of your private marketplace.",
    "Browse Products":
      "Discover your next bestseller. We take care of the rest.",
    Products: "Curate the catalog your sellers will love.",
    "My Credits": "Your products. Your credits. Ready when you are.",
    "Credit Requests": "A clear view of your product credit requests.",
    "Submit Shipping Label": "You made the sale. Let’s get it on its way.",
    "My Orders": "Follow every order from label to doorstep.",
    Inventory: "Keep every unit and commitment accounted for.",
    "Payment Verification":
      "Verify funds received, then approve product credits.",
  };
  return (
    <div className="app">
      {mobile && (
        <div className="navigation-backdrop" onClick={closeNavigation} aria-hidden="true" />
      )}
      <aside id="workspace-navigation" className={`sidebar ${mobile ? "open" : ""}`}>
        <button className="navigation-close" onClick={closeNavigation} aria-label="Close navigation">
          <X size={22} />
        </button>
        <button
          className="brand"
          aria-label="GPOP Fulfillment home"
          onClick={() => navigate(admin ? "Overview" : "Dashboard")}
        >
          <Brand />
        </button>
        <div className="workspace-switch">
          <div className="workspace-icon">
            <ShoppingBag size={18} />
          </div>
          <span>
            {admin ? "Admin workspace" : "Seller workspace"}
            <small>PRIVATE BETA</small>
          </span>
          <ChevronDown size={15} />
        </div>
        <p className="nav-label">{admin ? "ADMINISTRATION" : "WORKSPACE"}</p>
        <nav>
          {nav.map(([label, Icon]) => (
            <button
              className={page === label ? "active" : ""}
              key={label}
              onClick={() => navigate(label)}
            >
              <Icon size={18} />
              <span>{label}</span>
              {label === "My Orders" && outstanding.length > 0 && (
                <span className="nav-count">{outstanding.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="partner-card">
            <div className="partner-symbol">
              <ShieldCheck size={22} />
            </div>
            <strong>Built for your next chapter.</strong>
            <p>You sell. We handle the rest.</p>
            <button onClick={() => navigate("Settings")}>
              Your fulfillment partner <ArrowUpRight size={13} />
            </button>
          </div>
          <button className="user" onClick={() => navigate("Settings")}>
            <span className="avatar">
              {(profile?.name || profile?.email || "RW")
                .slice(0, 2)
                .toUpperCase()}
            </span>
            <span>
              {profile?.name || "Your workspace"}
              <small>{admin ? "Administrator" : "Seller account"}</small>
            </span>
            <Settings size={16} />
          </button>
          {session && (
            <button className="signout" onClick={() => void db!.auth.signOut()}>
              <LogOut size={14} />
              Sign out
            </button>
          )}
        </div>
      </aside>
      <div className="main-wrap">
        <header className="topbar">
          <button
            className="mobile-menu"
            ref={menuButton}
            aria-label="Open navigation"
            aria-controls="workspace-navigation"
            aria-expanded={mobile}
            onClick={() => setMobile(true)}
          >
            <Menu />
          </button>
          <div className="breadcrumbs">
            Workspace <ChevronRight size={13} />
            <span>{page}</span>
          </div>
          <div className="topbar-right">
            <span className="beta-pill">
              <span />
              Private beta
            </span>
            <button
              className="bell"
              aria-label={`${unread} unread notifications`}
              onClick={() => navigate(admin ? "Activity Logs" : "Activity")}
            >
              <Bell size={19} />
              {unread > 0 && <i />}
            </button>
            <span className="avatar small-avatar">
              {(profile?.name || "RW").slice(0, 2).toUpperCase()}
            </span>
          </div>
        </header>
        <nav className="mobile-tabs" aria-label="Quick navigation">
          {mobileTabs.map(([route, label, Icon]) => (
            <button
              key={route}
              aria-current={page === route ? "page" : undefined}
              onClick={() => navigate(route)}
            >
              <Icon size={21} />
              {label}
            </button>
          ))}
        </nav>
        <main>
          <div className="page-heading">
            <div>
              <div className="page-eyebrow">
                {admin ? "ADMINISTRATOR WORKSPACE" : "SELLER WORKSPACE"}
              </div>
              <h1>
                {page === "Dashboard"
                  ? `Welcome${profile?.name ? ", " + profile.name.split(" ")[0] : " to GPOP Fulfillment"}`
                  : page}
              </h1>
              <p>
                {descriptions[page] || "Your business, organized in one place."}
              </p>
            </div>
            {page === "Products" ? (
              <button className="primary" onClick={() => editProduct()}>
                <Plus size={17} />
                Add product
              </button>
            ) : page !== (admin ? "Fulfillment" : "Submit Shipping Label") ? (
              <button
                className="primary"
                onClick={() =>
                  navigate(admin ? "Fulfillment" : "Submit Shipping Label")
                }
              >
                <Plus size={17} />
                {admin ? "View fulfillment" : "Submit a label"}
              </button>
            ) : null}
          </div>
          {!configured && (
            <div className="setup-banner">
              <ShieldCheck size={20} />
              <div>
                <strong>Connect your workspace to get started</strong>
                <span>
                  Your data stays in your Supabase project. Add its URL and
                  public key to activate accounts, products, and orders.
                </span>
              </div>
              <button
                onClick={() =>
                  setModal(
                    <Modal
                      title="Activate your private workspace"
                      close={() => setModal(null)}
                    >
                      <ol className="setup-list">
                        <li>Create a free Supabase project at supabase.com.</li>
                        <li>
                          Follow the included README to apply the database
                          migration and deploy the invitation function.
                        </li>
                        <li>
                          Add your Project URL and publishable key to the
                          application’s environment settings.
                        </li>
                        <li>
                          Create your administrator account using the setup
                          guide, then invite your sellers.
                        </li>
                      </ol>
                      <p className="muted">
                        No demo orders or balances are created. Your workspace
                        begins with your real business data.
                      </p>
                    </Modal>,
                  )
                }
              >
                Setup guide <ArrowUpRight size={15} />
              </button>
            </div>
          )}
          {loading ? (
            <div className="empty">
              <div className="spinner" />
              <p>Loading your workspace…</p>
            </div>
          ) : (
            content
          )}
          <footer>
            <span>
              © {new Date().getFullYear()} GPOP Fulfillment. A better way to
              sell.
            </span>
            <span>
              <ShieldCheck size={13} />
              Private, by invitation.
            </span>
          </footer>
        </main>
      </div>
      {modal}
      {busy && (
        <div className="busy-cover" role="status">
          <div className="spinner" />
          Saving securely…
        </div>
      )}
      {error && (
        <div className="toast error" role="alert">
          {error}
          <button aria-label="Dismiss error" onClick={() => setError("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {notice && (
        <div className="toast" role="status">
          <Check size={17} />
          {notice}
          <button
            aria-label="Dismiss notification"
            onClick={() => setNotice("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
function Profit({ cost, resale }: { cost: number; resale: number }) {
  const [values, setValues] = useState([resale / 100, 0, 0, 0]);
  const profit = netProfit(
    values[0] * 100,
    cost,
    values[1] * 100,
    values[2] * 100,
    values[3] * 100,
  );
  return (
    <section className="calculator">
      <h3>Make the numbers work for you.</h3>
      <div className="calculator-fields">
        {[
          "Selling price ($)",
          "Marketplace fees ($)",
          "Shipping label ($)",
          "Other expenses ($)",
        ].map((label, i) => (
          <Field key={label} label={label}>
            <input
              type="number"
              min="0"
              step="0.01"
              value={values[i]}
              onChange={(e) =>
                setValues((v) =>
                  v.map((x, j) => (j === i ? Number(e.target.value) : x)),
                )
              }
            />
          </Field>
        ))}
      </div>
      <div className="total">
        Estimated net profit <strong>{money(profit)}</strong>
      </div>
      <small>Estimates only. Profits are not guaranteed.</small>
    </section>
  );
}

function FulfillmentForm({
  balances,
  variants,
  productName,
  onSubmit,
}: {
  balances: Row[];
  variants: Row[];
  productName: (id: string) => string;
  onSubmit: (p: Row) => Promise<void>;
}) {
  const [step, setStep] = useState(1),
    [vid, setVid] = useState(""),
    [quantity, setQuantity] = useState(1),
    [files, setFiles] = useState<File[]>([]),
    [marketplace, setMarketplace] = useState("eBay"),
    [orderId, setOrderId] = useState(""),
    [notes, setNotes] = useState(""),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false),
    [previews, setPreviews] = useState<string[]>([]);
  const key = useRef(crypto.randomUUID()),
    paths = useRef<Row[]>([]);
  const available = balances.find((b) => b.variant_id === vid)?.available || 0;
  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);
  const pick = (fs: File[]) => {
    if (!fs.length || fs.length > 10 || !fs.every(validLabel)) {
      setError("Choose 1–10 PDF, PNG, or JPG files, up to 10 MB each.");
      return;
    }
    paths.current = [];
    key.current = crypto.randomUUID();
    setFiles(fs);
    setError("");
  };
  const next = () => {
    setError("");
    if (step === 1 && (!vid || available < 1)) {
      setError("Choose a product with available credits.");
      return;
    }
    if (step === 2 && (!positiveInteger(quantity) || quantity > available)) {
      setError("Enter a whole quantity within your available credits.");
      return;
    }
    if (step === 3 && !files.length) {
      setError("Upload at least one prepaid shipping label.");
      return;
    }
    if (step === 4 && !marketplace.trim()) {
      setError("Enter a marketplace.");
      return;
    }
    setStep(step + 1);
  };
  const submit = async () => {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      if (paths.current.length === 0) {
        for (const f of files) {
          paths.current.push({
            path: await upload("shipping-labels", f),
            name: f.name,
          });
        }
      } else if (paths.current.length < files.length) {
        for (const f of files.slice(paths.current.length))
          paths.current.push({
            path: await upload("shipping-labels", f),
            name: f.name,
          });
      }
      await onSubmit({
        variant_id: vid,
        quantity,
        labels: paths.current,
        marketplace,
        marketplace_order_id: orderId,
        notes,
        idempotency_key: key.current,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="panel fulfillment-form">
      <div className="wizard-steps">
        {[
          "Product",
          "Quantity",
          "Shipping label",
          "Order details",
          "Confirm",
        ].map((s, i) => (
          <div className={step >= i + 1 ? "current" : ""} key={s}>
            <span>{step > i + 1 ? <Check size={14} /> : i + 1}</span>
            <small>{s}</small>
          </div>
        ))}
      </div>
      <div className="wizard-body">
        <span className="eyebrow">STEP {step} OF 5</span>
        <h2>
          {
            [
              "Choose the product you sold",
              "How many units are we shipping?",
              "Add your prepaid shipping label",
              "A few details about the sale",
              "Ready to hand it over?",
            ][step - 1]
          }
        </h2>
        {step === 1 && (
          <Field label="Product & variant">
            <select
              value={vid}
              onChange={(e) => {
                setVid(e.target.value);
                key.current = crypto.randomUUID();
              }}
            >
              <option value="">Select a product</option>
              {balances
                .filter(
                  (b) =>
                    b.available > 0 &&
                    variants.some((v) => v.id === b.variant_id),
                )
                .map((b) => (
                  <option key={b.variant_id} value={b.variant_id}>
                    {productName(b.variant_id)} · {b.available} credits
                    available
                  </option>
                ))}
            </select>
          </Field>
        )}
        {step === 2 && (
          <>
            <Field label={`Quantity (${available} credits available)`}>
              <input
                type="number"
                min="1"
                max={available}
                value={quantity}
                onChange={(e) => {
                  setQuantity(Number(e.target.value));
                  key.current = crypto.randomUUID();
                }}
              />
            </Field>
            <p className="muted">
              One credit covers one unit of this specific product.
            </p>
          </>
        )}
        {step === 3 && (
          <>
            <label
              className="dropzone"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                pick(Array.from(e.dataTransfer.files));
              }}
            >
              <Upload size={30} />
              <strong>Drop your labels here, or browse files</strong>
              <span>
                PDF, PNG or JPG · Up to 10 MB each · 10 labels maximum
              </span>
              <input
                type="file"
                accept="application/pdf,image/png,image/jpeg"
                multiple
                onChange={(e) => pick(Array.from(e.target.files || []))}
              />
            </label>
            <div className="label-previews">
              {files.map((f, i) => (
                <div key={f.name + i}>
                  {f.type.startsWith("image/") ? (
                    <img src={previews[i]} alt={`Prepaid label ${i + 1}`} />
                  ) : (
                    <iframe title={f.name} src={previews[i]} />
                  )}
                  <span>{f.name}</span>
                </div>
              ))}
            </div>
            <p className="muted">
              Purchase the label through your selling platform before uploading.
              Labels are stored privately.
            </p>
          </>
        )}
        {step === 4 && (
          <>
            <Field label="Marketplace">
              <input
                list="marketplaces"
                value={marketplace}
                onChange={(e) => setMarketplace(e.target.value)}
                required
                maxLength={100}
              />
              <datalist id="marketplaces">
                <option>eBay</option>
                <option>Depop</option>
                <option>Other</option>
              </datalist>
            </Field>
            <Field label="Marketplace order ID (optional)">
              <input
                value={orderId}
                maxLength={200}
                onChange={(e) => setOrderId(e.target.value)}
              />
            </Field>
            <Field label="Seller notes (optional)">
              <textarea
                value={notes}
                maxLength={2000}
                onChange={(e) => setNotes(e.target.value)}
              />
            </Field>
          </>
        )}
        {step === 5 && (
          <>
            <div className="review-list">
              <span>
                Product<strong>{productName(vid)}</strong>
              </span>
              <span>
                Quantity<strong>{quantity}</strong>
              </span>
              <span>
                Credits required<strong>{quantity}</strong>
              </span>
              <span>
                Remaining available credits
                <strong>{available - quantity}</strong>
              </span>
              <span>
                Marketplace<strong>{marketplace}</strong>
              </span>
              <span>
                Labels<strong>{files.map((f) => f.name).join(", ")}</strong>
              </span>
            </div>
            <div className="info">
              Submitting reserves {quantity} credits immediately. Credits are
              consumed when your administrator accepts fulfillment.
            </div>
          </>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          {step > 1 && (
            <button
              className="secondary"
              disabled={saving}
              onClick={() => setStep(step - 1)}
            >
              Back
            </button>
          )}
          {step < 5 ? (
            <button className="primary" onClick={next}>
              Continue <ArrowRight size={16} />
            </button>
          ) : (
            <button
              className="primary"
              disabled={saving}
              onClick={() => void submit()}
            >
              {saving ? "Submitting…" : "Submit fulfillment request"}
              <ArrowRight size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
function Auth({
  onError,
  error,
}: {
  onError: (s: string) => void;
  error: string;
}) {
  const [reset, setReset] = useState(false),
    [sent, setSent] = useState(false),
    [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    onError("");
    const f = new FormData(e.currentTarget);
    try {
      const result = reset
        ? await db!.auth.resetPasswordForEmail(f.get("email") as string, {
            redirectTo: location.origin + location.pathname,
          })
        : await db!.auth.signInWithPassword({
            email: f.get("email") as string,
            password: f.get("password") as string,
          });
      if (result.error) throw result.error;
      if (reset) setSent(true);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="auth-wrap">
      <div className="auth-story">
        <span className="brand light">
          <Brand />
        </span>
        <h1>
          Your business.
          <br />
          Our backing.
        </h1>
        <p>
          A private marketplace. A reliable fulfillment partner.
          <br />
          Everything you need for what’s next.
        </p>
        <span className="auth-seal">
          <ShieldCheck size={18} />
          Private, by invitation.
        </span>
      </div>
      <section className="auth-card">
        <span className="eyebrow">WELCOME TO YOUR WORKSPACE</span>
        <h2>{reset ? "Reset your password" : "Good to have you back."}</h2>
        <p className="muted">
          {reset
            ? "We’ll email you a secure password reset link."
            : "Sign in to find your next bestseller."}
        </p>
        <form onSubmit={submit}>
          <Field label="Email address">
            <input name="email" type="email" autoComplete="email" required />
          </Field>
          {!reset && (
            <Field label="Password">
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </Field>
          )}
          <button className="primary full" disabled={busy}>
            {busy ? "Please wait…" : reset ? "Send reset link" : "Sign in"}
            <ArrowRight size={16} />
          </button>
        </form>
        <button
          className="text-button"
          onClick={() => {
            setReset(!reset);
            setSent(false);
          }}
        >
          {reset ? "Back to sign in" : "Forgot your password?"}
        </button>
        {sent && (
          <div className="info">
            If this account exists, a reset email is on its way.
          </div>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="auth-footer">
          <ShieldCheck size={16} />
          <p>
            GPOP Fulfillment is invite-only. Contact your administrator for
            access.
          </p>
        </div>
      </section>
    </div>
  );
}
