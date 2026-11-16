import { Camera, FileText, Paperclip, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { api } from "../api";
import { fmtBytes } from "../format";
import { Button, Card, Empty, useToast } from "./ui";

type A = { id: number; file_id: number; original_name: string; mime_type: string; size_bytes: number; caption?: string | null };

export function Attachments({ entityType, entityId, items, canAdd, onChange, title = "Photos & attachments" }: {
  entityType: string; entityId: number; items: A[]; canAdd: boolean; onChange: () => void; title?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    const fd = new FormData();
    fd.set("entity_type", entityType);
    fd.set("entity_id", String(entityId));
    for (const f of Array.from(files)) fd.append("files", f);
    setBusy(true);
    try {
      await api.post("/attachments", fd);
      toast(`Uploaded ${files.length} file(s)`);
      onChange();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
      if (camera.current) camera.current.value = "";
    }
  }

  return (
    <Card
      title={title}
      icon={Paperclip}
      actions={
        canAdd && (
          <>
            <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => upload(e.target.files)} />
            <input ref={input} type="file" multiple hidden accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.gif,.doc,.docx,.xls,.xlsx,.csv,.txt" onChange={(e) => upload(e.target.files)} />
            <Button size="sm" icon={Camera} busy={busy} onClick={() => camera.current?.click()} className="show-mobile">
              Photo
            </Button>
            <Button size="sm" icon={Paperclip} busy={busy} onClick={() => input.current?.click()}>
              Upload
            </Button>
          </>
        )
      }
    >
      {items.length ? (
        <div className="thumbs">
          {items.map((a) => (
            <div className="thumb" key={a.id}>
              <a href={`/api/files/${a.file_id}`} target="_blank" rel="noreferrer">
                {a.mime_type.startsWith("image/") && a.mime_type !== "image/heic" ? (
                  <img src={`/api/files/${a.file_id}`} alt={a.caption ?? a.original_name} loading="lazy" />
                ) : (
                  <div className="file-icon"><FileText size={30} /></div>
                )}
              </a>
              <div className="cap row between">
                <span title={a.original_name} style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{a.original_name}</span>
                {canAdd && (
                  <button
                    className="btn ghost sm icon"
                    style={{ width: 24, height: 24 }}
                    title="Remove"
                    onClick={async () => {
                      if (!confirm(`Remove ${a.original_name}?`)) return;
                      await api.del(`/attachments/${a.id}`).catch((e) => toast(e.message, "error"));
                      onChange();
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
              <div className="cap muted">{fmtBytes(a.size_bytes)}</div>
            </div>
          ))}
        </div>
      ) : (
        <Empty>No files yet.</Empty>
      )}
    </Card>
  );
}
