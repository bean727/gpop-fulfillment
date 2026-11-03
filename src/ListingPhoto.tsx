import { useEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";

export default function ListingPhoto({
  onUpload,
}: {
  onUpload: (preparePhoto: () => Promise<File>) => Promise<void>;
}) {
  const [file, setFile] = useState<File>();
  const [url, setUrl] = useState("");
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [position, setPosition] = useState({ x: 0.5, y: 0.5 });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const image = useRef<HTMLImageElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number }>(null);

  useEffect(() => {
    if (!file) return;
    const preview = URL.createObjectURL(file);
    setUrl(preview);
    return () => URL.revokeObjectURL(preview);
  }, [file]);

  const select = (photo?: File) => {
    if (!photo) return;
    setFile(photo);
    setSize({ width: 0, height: 0 });
    setPosition({ x: 0.5, y: 0.5 });
    setZoom(1);
    setError("");
  };

  const side = Math.min(size.width, size.height) / zoom;
  const extraX = size.width - side;
  const extraY = size.height - side;
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const frame = event.currentTarget.clientWidth;
    const start = drag.current;
    const clamp = (value: number) => Math.max(0, Math.min(1, value));
    setPosition({
      x: extraX ? clamp(start.left - (event.clientX - start.x) * side / (frame * extraX)) : 0.5,
      y: extraY ? clamp(start.top - (event.clientY - start.y) * side / (frame * extraY)) : 0.5,
    });
  };

  const save = async (crop: boolean) => {
    const source = image.current;
    if (!file || !source || !side || busy) return;
    setBusy(true);
    setError("");
    try {
      await onUpload(async () => {
        if (!crop) return file;
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = Math.max(1, Math.min(1600, Math.round(side)));
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Photo cropping is unavailable on this device.");
        context.fillStyle = "#fff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(source, extraX * position.x, extraY * position.y,
          side, side, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
        if (!blob) throw new Error("Could not prepare the cropped photo.");
        return new File([blob], file.name.replace(/\.[^.]+$/, "") + "-crop.jpg", { type: blob.type });
      });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not upload the photo.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="listing-photo">
      <div className="button-row">
        <label className="upload-link">
          Take photo
          <input type="file" accept="image/*" capture="environment" disabled={busy}
            onChange={(event) => { select(event.target.files?.[0]); event.target.value = ""; }} />
        </label>
        <label className="upload-link">
          Choose photo
          <input type="file" accept="image/*" disabled={busy}
            onChange={(event) => { select(event.target.files?.[0]); event.target.value = ""; }} />
        </label>
      </div>
      {url && (
        <>
          <p>Drag the photo to position it inside the square. Use the sliders to fine-tune the crop.</p>
          <div className="listing-photo-frame"
            onPointerDown={(event) => {
              if (busy || !side || event.button !== 0) return;
              drag.current = { x: event.clientX, y: event.clientY, left: position.x, top: position.y };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={move}
            onLostPointerCapture={() => { drag.current = null; }}
          >
            <img key={url} ref={image} src={url} alt="Product photo crop preview" draggable={false}
              onLoad={(event) => {
                setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight });
              }}
              onError={() => setError("This photo could not be opened. Try a JPEG, PNG, or WebP photo.")}
              style={side ? {
                width: `${100 * size.width / side}%`,
                height: `${100 * size.height / side}%`,
                left: `${-100 * extraX * position.x / side}%`,
                top: `${-100 * extraY * position.y / side}%`,
              } : { visibility: "hidden" }}
            />
          </div>
          {side > 0 && (
            <>
              <label className="field">
                <span>Zoom</span>
                <input type="range" min="1" max="4" step="0.01" value={zoom}
                  disabled={busy} onChange={(event) => setZoom(event.target.valueAsNumber)} />
              </label>
              <div className="listing-photo-position">
                {(["x", "y"] as const).map((axis) => (
                  <label className="field" key={axis}>
                    <span>{axis === "x" ? "Horizontal position" : "Vertical position"}</span>
                    <input type="range" min="0" max="1" step="0.01" value={position[axis]}
                      disabled={busy || (axis === "x" ? !extraX : !extraY)}
                      onChange={(event) => {
                        const value = event.target.valueAsNumber;
                        setPosition((current) => ({ ...current, [axis]: value }));
                      }} />
                  </label>
                ))}
              </div>
              <div className="form-actions">
                <button type="button" disabled={busy || !["image/jpeg", "image/png", "image/webp"].includes(file?.type || "")}
                  onClick={() => void save(false)}>Use original</button>
                <button type="button" className="primary" disabled={busy}
                  onClick={() => void save(true)}>{busy ? "Uploading…" : "Upload cropped photo"}</button>
              </div>
            </>
          )}
        </>
      )}
      {error && <p role="alert" className="listing-photo-error">{error}</p>}
    </div>
  );
}
