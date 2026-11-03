import { useState } from "react";
import { db, signedLabel, upload } from "./api";

// Development-only live integration check. Creates a clearly marked file, never an order.
export default function LabelStorageCheck() {
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);
  async function check() {
    if (!db || busy) return;
    setBusy(true);
    setResult("Checking private label upload…");
    try {
      const stream =
        "BT /F1 16 Tf 40 740 Td (UPLOAD TEST ONLY - NOT A SHIPPING LABEL) Tj ET";
      const objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
      ];
      let pdf = "%PDF-1.4\n";
      const offsets: number[] = [];
      objects.forEach((object, index) => {
        offsets.push(pdf.length);
        pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
      });
      const xref = pdf.length;
      pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.map((offset) => String(offset).padStart(10, "0") + " 00000 n \n").join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
      const file = new File([pdf], "relay-label-upload-test.pdf", {
        type: "application/pdf",
      });
      const path = await upload("shipping-labels", file);
      const signed = await signedLabel(path);
      const response = await fetch(signed);
      if (!response.ok || (await response.text()) !== pdf)
        throw new Error(
          "Signed download did not match the uploaded test file.",
        );
      const publicURL = db.storage.from("shipping-labels").getPublicUrl(path)
        .data.publicUrl;
      const publicResponse = await fetch(publicURL);
      if (publicResponse.ok)
        throw new Error(
          "The label was publicly accessible. Check the storage bucket privacy setting.",
        );
      setResult(
        "PASS: PDF uploaded; expiring signed download returned the exact file; public access was blocked. No order created and no credits changed.",
      );
    } catch (error) {
      setResult(`FAIL: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel padded">
      <h3>Label upload check</h3>
      <p className="muted">
        Local verification using a small PDF clearly marked as a test. It does
        not submit fulfillment.
      </p>
      <button
        className="secondary"
        disabled={busy}
        onClick={() => void check()}
      >
        {busy ? "Checking label uploads…" : "Test label uploads"}
      </button>
      {result && (
        <p role="status" className="info">
          {result}
        </p>
      )}
    </section>
  );
}
