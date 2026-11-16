import { useEffect, useRef, useState } from "react";
import { Alert, Button, Field, Input, Modal } from "./ui";

/**
 * QR / barcode scanning using the browser's built-in BarcodeDetector (Chrome/Edge on Android,
 * desktop Chrome, recent Safari). Falls back to typing the code (or using a USB/Bluetooth
 * scanner, which types into the field like a keyboard).
 */
export function ScannerModal({ onClose, onCode }: { onClose: () => void; onCode: (code: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [manual, setManual] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const supported = typeof window !== "undefined" && "BarcodeDetector" in window;

  useEffect(() => {
    if (!supported) return;
    let stream: MediaStream | null = null;
    let stop = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (!video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const detector = new (window as any).BarcodeDetector({ formats: ["qr_code", "code_128", "code_39", "ean_13", "ean_8", "upc_a", "upc_e", "data_matrix"] });
        const loop = async () => {
          if (stop || !video.current) return;
          try {
            const codes = await detector.detect(video.current);
            if (codes.length) {
              onCode(String(codes[0].rawValue));
              return;
            }
          } catch {
            /* frame not ready */
          }
          setTimeout(loop, 250);
        };
        loop();
      } catch {
        setStatus("Camera unavailable or permission denied. Type the code instead.");
      }
    })();
    return () => {
      stop = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [supported, onCode]);

  return (
    <Modal title="Scan QR code or barcode" onClose={onClose} footer={<Button variant="primary" disabled={!manual.trim()} onClick={() => onCode(manual.trim())}>Look up</Button>}>
      <div className="stack">
        {supported ? (
          <video ref={video} playsInline muted style={{ width: "100%", borderRadius: 8, background: "#111", maxHeight: 320, objectFit: "cover" }} />
        ) : (
          <Alert kind="info">This browser can't scan with the camera. Type the code, or use a handheld barcode scanner.</Alert>
        )}
        {status && <Alert kind="warn">{status}</Alert>}
        <Field label="Or enter code / asset number">
          <Input autoFocus={!supported} value={manual} onChange={(e) => setManual(e.target.value)} onKeyDown={(e) => e.key === "Enter" && manual.trim() && onCode(manual.trim())} />
        </Field>
      </div>
    </Modal>
  );
}
