import { toast } from "sonner";
import { api } from "./api";
import { ACCEPTED } from "./nodes";

/** A file waiting to be uploaded and the folders (relative to the drop target) it belongs in. */
export type Pending = { file: File; dirs: string[] };

function readAll(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const all: FileSystemEntry[] = [];
    // readEntries hands out the directory in batches and signals the end with an empty one.
    const next = () => reader.readEntries((batch) => (batch.length ? (all.push(...batch), next()) : resolve(all)), reject);
    next();
  });
}

async function walk(entry: FileSystemEntry, dirs: string[], out: Pending[]) {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
    out.push({ file, dirs });
  } else if (entry.isDirectory) {
    const children = await readAll((entry as FileSystemDirectoryEntry).createReader());
    for (const child of children) await walk(child, [...dirs, entry.name], out);
  }
}

/** Files of a drop, including everything inside dropped folders. Must be called inside the drop handler. */
export async function collectDropped(data: DataTransfer): Promise<Pending[]> {
  // The entries are only readable while the drop event is being handled, so grab them before awaiting.
  const entries = [...data.items].map((item) => item.webkitGetAsEntry?.()).filter((entry): entry is FileSystemEntry => !!entry);
  if (!entries.length) return [...data.files].map((file) => ({ file, dirs: [] }));
  const out: Pending[] = [];
  for (const entry of entries) await walk(entry, [], out);
  return out;
}

const PARALLEL = 3;

/** Recreates the dropped folder structure below parentId, uploads the invoices and reports progress as a toast. */
export async function uploadAll(parentId: string | null, pending: Pending[]) {
  const accepted = pending.filter(({ file }) => ACCEPTED.test(file.name));
  const skipped = pending.length - accepted.length;
  if (skipped) toast.warning(skipped === 1 ? "1 Datei übersprungen, sie ist weder PDF noch XML" : `${skipped} Dateien übersprungen, sie sind weder PDF noch XML`);
  if (!accepted.length) return;

  const id = toast.loading(`0 von ${accepted.length} hochgeladen`);
  const failures: string[] = [];
  let done = 0;

  try {
    // Folders first and one at a time, so two files of the same folder don't both create it.
    const folderIds = new Map<string, string | null>([["", parentId]]);
    const targets: (string | null)[] = [];
    for (const { dirs } of accepted) {
      let key = "";
      let current = parentId;
      for (const dir of dirs) {
        key += `/${dir}`;
        if (!folderIds.has(key)) folderIds.set(key, (await api.createFolder(current, dir)).id);
        current = folderIds.get(key)!;
      }
      targets.push(current);
    }

    let next = 0;
    const worker = async () => {
      while (next < accepted.length) {
        const index = next++;
        const { file } = accepted[index];
        try {
          await api.upload(targets[index], file);
        } catch (error) {
          failures.push(`${file.name}: ${error instanceof Error ? error.message : "fehlgeschlagen"}`);
        }
        toast.loading(`${++done} von ${accepted.length} hochgeladen`, { id });
      }
    };
    await Promise.all(Array.from({ length: PARALLEL }, worker));
  } catch (error) {
    failures.push(error instanceof Error ? error.message : "Hochladen fehlgeschlagen");
  }

  const uploaded = accepted.length - failures.length;
  if (failures.length) toast.error(`${failures.length} nicht hochgeladen`, { id, description: failures.slice(0, 5).join("\n") });
  else toast.success(uploaded === 1 ? "1 Datei hochgeladen" : `${uploaded} Dateien hochgeladen`, { id });
}
