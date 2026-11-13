"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ChevronRight, CircleCheck, CircleX, Download, FileText, Folder, FolderInput, FolderPlus, PenLine, Trash2, TriangleAlert, Upload, X } from "lucide-react";
import { parseAsString, useQueryStates } from "nuqs";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { MoveDialog } from "@/components/move-dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Logo } from "@/components/logo";
import { UserMenu } from "@/components/user-menu";
import { api, download } from "@/lib/api";
import type { Node } from "@/lib/nodes";
import { collectDropped, uploadAll, type Pending } from "@/lib/upload";
import { cn } from "@/lib/utils";

/** Marks drags that started on a row, as opposed to files dragged in from the desktop. */
const DRAG_TYPE = "application/x-zugferd-nodes";
const ROOT_NAME = "Rechnungen";

type SortKey = "name" | "status" | "size" | "updatedAt";
const COLUMNS: { key: SortKey; label: string; className: string }[] = [
  { key: "name", label: "Name", className: "" },
  { key: "status", label: "Prüfung", className: "" },
  { key: "size", label: "Größe", className: "justify-end text-right" },
  { key: "updatedAt", label: "Geändert", className: "hidden @2xl:flex" },
];
const GRID = "grid grid-cols-[minmax(0,1fr)_9rem_5.5rem] @2xl:grid-cols-[minmax(0,1fr)_9rem_5.5rem_10rem] items-center gap-3 px-4";

const STATUS = {
  einvoice: { label: "E-Rechnung", icon: CircleCheck, color: "text-emerald-600" },
  valid: { label: "Kein EN 16931", icon: TriangleAlert, color: "text-amber-600" },
  invalid: { label: "Ungültig", icon: CircleX, color: "text-red-600" },
} as const;

const dateFormat = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" });

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString("de-DE")} kB`;
  return `${(bytes / 1024 / 1024).toLocaleString("de-DE", { maximumFractionDigits: 1 })} MB`;
}

function RenameInput({ node, onDone }: { node: Node; onDone: (name: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    const input = ref.current!;
    input.focus();
    // Leave the extension unselected so typing replaces only the name.
    const dot = node.kind === "file" ? node.name.lastIndexOf(".") : -1;
    input.setSelectionRange(0, dot > 0 ? dot : node.name.length);
  }, [node]);

  const finish = (name: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(name);
  };

  return (
    <input
      ref={ref}
      defaultValue={node.name}
      aria-label="Name"
      className="h-7 min-w-0 flex-1 rounded-md border border-ring bg-background px-1.5 text-sm outline-none ring-2 ring-ring/30"
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onBlur={(event) => finish(event.target.value)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") finish(event.currentTarget.value);
        if (event.key === "Escape") finish(null);
      }}
    />
  );
}

export function FileManager() {
  const [{ ordner }, setQuery] = useQueryStates({ ordner: parseAsString, datei: parseAsString });
  const queryClient = useQueryClient();
  const listing = useQuery({ queryKey: ["nodes", ordner], queryFn: () => api.list(ordner) });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({ key: "name", descending: false });
  const [deleting, setDeleting] = useState<Node[] | null>(null);
  const [moving, setMoving] = useState<Node[] | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const [shownFolder, setShownFolder] = useState(ordner);
  if (shownFolder !== ordner) {
    setShownFolder(ordner);
    setSelected(new Set());
    setRenaming(null);
  }

  const items = useMemo(() => {
    const direction = sort.descending ? -1 : 1;
    const compare = (a: Node, b: Node) => {
      // Folders stay on top whatever the sort order.
      if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
      const byName = a.name.localeCompare(b.name, "de", { numeric: true, sensitivity: "base" });
      if (sort.key === "size") return ((a.size ?? 0) - (b.size ?? 0)) * direction || byName;
      if (sort.key === "updatedAt") return a.updatedAt.localeCompare(b.updatedAt) * direction || byName;
      if (sort.key === "status") return (a.status ?? "").localeCompare(b.status ?? "") * direction || byName;
      return byName * direction;
    };
    return [...(listing.data?.items ?? [])].sort(compare);
  }, [listing.data, sort]);

  const selection = items.filter((item) => selected.has(item.id));
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["nodes"] });
    queryClient.invalidateQueries({ queryKey: ["folders"] });
  };
  const fail = (error: Error) => toast.error(error.message);

  const createFolder = useMutation({
    mutationFn: () => api.createFolder(ordner, "Neuer Ordner"),
    onSuccess: (node) => {
      refresh();
      setSelected(new Set([node.id]));
      // Straight into renaming, like every desktop file manager.
      setRenaming(node.id);
    },
    onError: fail,
  });
  const rename = useMutation({ mutationFn: ({ id, name }: { id: string; name: string }) => api.rename(id, name), onSuccess: refresh, onError: fail });
  const move = useMutation({
    mutationFn: ({ ids, parentId }: { ids: string[]; parentId: string | null }) => api.move(ids, parentId),
    onSuccess: () => {
      refresh();
      setSelected(new Set());
    },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (ids: string[]) => api.remove(ids),
    onSuccess: () => {
      refresh();
      setSelected(new Set());
    },
    onError: fail,
  });

  const upload = async (parentId: string | null, pending: Pending[]) => {
    await uploadAll(parentId, pending);
    refresh();
  };

  const open = (node: Node) => setQuery(node.kind === "folder" ? { ordner: node.id } : { datei: node.id });

  const select = (node: Node, event: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => {
    if (event.shiftKey && anchor) {
      const from = items.findIndex((item) => item.id === anchor);
      const to = items.findIndex((item) => item.id === node.id);
      if (from >= 0) {
        setSelected(new Set(items.slice(Math.min(from, to), Math.max(from, to) + 1).map((item) => item.id)));
        return;
      }
    }
    if (event.metaKey || event.ctrlKey) {
      const next = new Set(selected);
      if (!next.delete(node.id)) next.add(node.id);
      setSelected(next);
    } else setSelected(new Set([node.id]));
    setAnchor(node.id);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    // Typing in a field, an open dialog or an open menu keeps its own keys.
    if (renaming || deleting || moving || (event.target as HTMLElement).closest("input, textarea, [role=menu], [role=dialog], [role=alertdialog]")) return;
    const single = selection.length === 1 ? selection[0] : null;
    if (event.key === "Enter" && single) open(single);
    else if (event.key === "F2" && single) setRenaming(single.id);
    else if ((event.key === "Delete" || event.key === "Backspace") && selection.length) setDeleting(selection);
    else if (event.key === "Escape") setSelected(new Set());
    else if (event.key === "a" && (event.metaKey || event.ctrlKey)) setSelected(new Set(items.map((item) => item.id)));
    else if ((event.key === "ArrowDown" || event.key === "ArrowUp") && items.length) {
      const current = items.findIndex((item) => item.id === anchor);
      const next = items[Math.min(items.length - 1, Math.max(0, current + (event.key === "ArrowDown" ? 1 : -1)))];
      select(next, { shiftKey: event.shiftKey, metaKey: false, ctrlKey: false });
      list.current?.querySelector(`[data-row="${next.id}"]`)?.scrollIntoView({ block: "nearest" });
    } else return;
    event.preventDefault();
  };
  // The shortcuts work wherever the focus is, so the handler sits on the window and always sees current state.
  const keyHandler = useRef(onKeyDown);
  useEffect(() => {
    keyHandler.current = onKeyDown;
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => keyHandler.current(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  /** Shared by folder rows, breadcrumbs and the list itself: accepts rows dragged within the app and files from outside. */
  const dropProps = (targetId: string | null, key: string) => ({
    onDragOver: (event: React.DragEvent) => {
      const internal = event.dataTransfer.types.includes(DRAG_TYPE);
      if (!internal && !event.dataTransfer.types.includes("Files")) return;
      // Dropping rows onto the folder they are already in would do nothing.
      if (internal && targetId === ordner) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = internal ? "move" : "copy";
      setDropTarget(key);
    },
    onDragLeave: () => setDropTarget((current) => (current === key ? null : current)),
    onDrop: (event: React.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setDropTarget(null);
      const ids = event.dataTransfer.getData(DRAG_TYPE);
      if (ids) move.mutate({ ids: ids.split(",").filter((id) => id !== targetId), parentId: targetId });
      else collectDropped(event.dataTransfer).then((pending) => upload(targetId, pending));
    },
  });

  const path = listing.data?.path ?? [];
  const crumbs = [{ id: null as string | null, name: ROOT_NAME }, ...path];
  const single = selection.length === 1 ? selection[0] : null;

  return (
    <main className="flex h-dvh flex-col">
      <input
        ref={fileInput}
        type="file"
        multiple
        accept=".pdf,.xml"
        className="hidden"
        onChange={(event) => {
          upload(ordner, [...(event.target.files ?? [])].map((file) => ({ file, dirs: [] })));
          event.target.value = "";
        }}
      />

      <header className="shrink-0 border-b">
        <div className="mx-auto flex h-12 w-full max-w-6xl items-center gap-2 px-3">
        <Logo className="size-6 shrink-0" />
        <nav aria-label="Pfad" className="flex min-w-0 flex-1 items-center gap-0.5 text-sm">
          {crumbs.map((crumb, index) => {
            const last = index === crumbs.length - 1;
            const key = `crumb:${crumb.id}`;
            return (
              <div key={key} className="flex min-w-0 items-center gap-0.5">
                {index > 0 && <ChevronRight className="size-4 shrink-0 text-muted-foreground" />}
                <button
                  type="button"
                  aria-current={last ? "page" : undefined}
                  onClick={() => setQuery({ ordner: crumb.id })}
                  {...dropProps(crumb.id, key)}
                  className={cn(
                    "truncate rounded-md px-1.5 py-1 hover:bg-muted",
                    last ? "font-medium" : "text-muted-foreground",
                    dropTarget === key && "bg-primary/10 ring-2 ring-primary",
                  )}
                >
                  {crumb.name}
                </button>
              </div>
            );
          })}
        </nav>

        {selection.length > 0 ? (
          <>
            <span className="text-sm text-muted-foreground tabular-nums">{selection.length} ausgewählt</span>
            <Button variant="outline" size="sm" onClick={() => download(selection.map((node) => node.id))}>
              <Download /> Herunterladen
            </Button>
            <Button variant="outline" size="sm" onClick={() => setMoving(selection)}>
              <FolderInput /> Verschieben
            </Button>
            <Button variant="outline" size="sm" onClick={() => setDeleting(selection)}>
              <Trash2 /> Löschen
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Auswahl aufheben" onClick={() => setSelected(new Set())}>
              <X />
            </Button>
          </>
        ) : (
          <>
            <Button variant="outline" size="sm" onClick={() => createFolder.mutate()}>
              <FolderPlus /> Neuer Ordner
            </Button>
            <Button size="sm" onClick={() => fileInput.current?.click()}>
              <Upload /> Hochladen
            </Button>
          </>
        )}
        <UserMenu />
        </div>
      </header>

      <ContextMenu>
        <ContextMenuTrigger
          render={
            <div
              ref={list}
              onClick={(event) => {
                if (!(event.target as HTMLElement).closest("[data-row]")) setSelected(new Set());
              }}
              onContextMenu={(event) => {
                if (!(event.target as HTMLElement).closest("[data-row]")) setSelected(new Set());
              }}
              {...dropProps(ordner, "list")}
              className={cn("min-h-0 flex-1 overflow-auto outline-none", dropTarget === "list" && "bg-primary/5 ring-2 ring-primary ring-inset")}
            />
          }
        >
          <div className="@container mx-auto w-full max-w-6xl">
          <div role="row" className={cn(GRID, "sticky top-0 z-10 h-9 border-b bg-background text-xs text-muted-foreground")}>
            {COLUMNS.map((column) => (
              <button
                key={column.key}
                type="button"
                onClick={() => setSort((current) => ({ key: column.key, descending: current.key === column.key && !current.descending }))}
                className={cn("flex items-center gap-1 hover:text-foreground", column.className)}
              >
                {column.label}
                {sort.key === column.key && (sort.descending ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
              </button>
            ))}
          </div>

          {items.map((node) => {
            const isSelected = selected.has(node.id);
            const status = node.status ? STATUS[node.status] : null;
            const key = `row:${node.id}`;
            return (
              <div
                key={node.id}
                role="row"
                data-row={node.id}
                aria-selected={isSelected}
                draggable={renaming !== node.id}
                onClick={(event) => select(node, event)}
                onDoubleClick={() => open(node)}
                onContextMenu={() => {
                  if (!isSelected) {
                    setSelected(new Set([node.id]));
                    setAnchor(node.id);
                  }
                }}
                onDragStart={(event) => {
                  const ids = isSelected ? [...selected] : [node.id];
                  if (!isSelected) setSelected(new Set(ids));
                  event.dataTransfer.setData(DRAG_TYPE, ids.join(","));
                  event.dataTransfer.effectAllowed = "move";
                }}
                {...(node.kind === "folder" ? dropProps(node.id, key) : {})}
                className={cn(
                  GRID,
                  "h-10 cursor-default border-b text-sm select-none",
                  isSelected ? "bg-primary/10" : "hover:bg-muted/50",
                  dropTarget === key && "bg-primary/10 ring-2 ring-primary ring-inset",
                )}
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  {node.kind === "folder" ? <Folder className="size-4 shrink-0 fill-sky-500/20 text-sky-600" /> : <FileText className="size-4 shrink-0 text-muted-foreground" />}
                  {renaming === node.id ? (
                    <RenameInput
                      node={node}
                      onDone={(name) => {
                        setRenaming(null);
                        if (name && name.trim() !== node.name) rename.mutate({ id: node.id, name: name.trim() });
                      }}
                    />
                  ) : (
                    <span className="truncate">{node.name}</span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 whitespace-nowrap">
                  {status && (
                    <>
                      <status.icon className={cn("size-4 shrink-0", status.color)} /> {status.label}
                    </>
                  )}
                  {node.kind === "file" && !status && <span className="text-muted-foreground">Nicht geprüft</span>}
                </div>
                <div className="text-right text-muted-foreground tabular-nums">{node.size !== null && formatSize(node.size)}</div>
                <div className="hidden whitespace-nowrap text-muted-foreground @2xl:block">{dateFormat.format(new Date(node.updatedAt))}</div>
              </div>
            );
          })}

          {listing.isSuccess && items.length === 0 && (
            <div className="flex flex-col items-center gap-2 px-6 py-24 text-center text-sm text-muted-foreground">
              <Upload className="size-8" strokeWidth={1.5} />
              <p>PDF- und XML-Rechnungen hierher ziehen</p>
            </div>
          )}
          {listing.isError && (
            <div className="flex flex-col items-center gap-3 px-6 py-24 text-center text-sm">
              <p>{listing.error.message}</p>
              <Button variant="outline" size="sm" onClick={() => setQuery({ ordner: null })}>
                Zu {ROOT_NAME}
              </Button>
            </div>
          )}
          </div>
        </ContextMenuTrigger>

        <ContextMenuContent className="min-w-48">
          {selection.length === 0 ? (
            <>
              <ContextMenuItem onClick={() => createFolder.mutate()}>
                <FolderPlus /> Neuer Ordner
              </ContextMenuItem>
              <ContextMenuItem onClick={() => fileInput.current?.click()}>
                <Upload /> Dateien hochladen
              </ContextMenuItem>
            </>
          ) : (
            <>
              {single && (
                <ContextMenuItem onClick={() => open(single)}>
                  {single.kind === "folder" ? <Folder /> : <FileText />} Öffnen
                </ContextMenuItem>
              )}
              <ContextMenuItem onClick={() => download(selection.map((node) => node.id))}>
                <Download /> Herunterladen
              </ContextMenuItem>
              <ContextMenuSeparator />
              {single && (
                <ContextMenuItem onClick={() => setRenaming(single.id)}>
                  <PenLine /> Umbenennen
                </ContextMenuItem>
              )}
              <ContextMenuItem onClick={() => setMoving(selection)}>
                <FolderInput /> Verschieben
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem variant="destructive" onClick={() => setDeleting(selection)}>
                <Trash2 /> Löschen
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>

      <AlertDialog open={deleting !== null} onOpenChange={(isOpen) => !isOpen && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{deleting?.length === 1 ? `„${deleting[0].name}“ löschen?` : `${deleting?.length} Elemente löschen?`}</AlertDialogTitle>
            {deleting?.some((node) => node.kind === "folder") && <AlertDialogDescription>Ordner werden mit allem gelöscht, was darin liegt.</AlertDialogDescription>}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (deleting) remove.mutate(deleting.map((node) => node.id));
                setDeleting(null);
              }}
            >
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {moving && (
        <MoveDialog
          nodes={moving}
          rootName={ROOT_NAME}
          onClose={() => setMoving(null)}
          onMove={(parentId) => {
            move.mutate({ ids: moving.map((node) => node.id), parentId });
            setMoving(null);
          }}
        />
      )}
    </main>
  );
}

