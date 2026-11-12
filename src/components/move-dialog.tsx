"use client";

import { useQuery } from "@tanstack/react-query";
import { Folder as FolderIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import type { Folder, Node } from "@/lib/nodes";
import { cn } from "@/lib/utils";

type Props = { nodes: Node[]; rootName: string; onClose: () => void; onMove: (parentId: string | null) => void };

export function MoveDialog({ nodes, rootName, onClose, onMove }: Props) {
  const folders = useQuery({ queryKey: ["folders"], queryFn: api.folders });
  // undefined = nothing picked yet, null = the root folder.
  const [target, setTarget] = useState<string | null | undefined>(undefined);

  const moved = new Set(nodes.map((node) => node.id));
  const from = nodes[0]?.parentId ?? null;
  const children = (parentId: string | null) => (folders.data ?? []).filter((folder) => folder.parentId === parentId);

  const row = (id: string | null, name: string, depth: number) => (
    <button
      type="button"
      disabled={id === from}
      aria-pressed={target === id}
      onClick={() => setTarget(id)}
      onDoubleClick={() => onMove(id)}
      style={{ paddingLeft: `${depth * 1.25 + 0.5}rem` }}
      className={cn("flex h-8 w-full items-center gap-2 rounded-md pr-2 text-left text-sm disabled:opacity-40", target === id ? "bg-primary text-primary-foreground" : "hover:bg-muted")}
    >
      <FolderIcon className="size-4 shrink-0" />
      <span className="truncate">{name}</span>
    </button>
  );

  // A folder cannot move into itself, so it and everything below it are left out of the tree.
  const branch = (folder: Folder, depth: number): React.ReactNode =>
    moved.has(folder.id) ? null : (
      <li key={folder.id}>
        {row(folder.id, folder.name, depth)}
        <ul>{children(folder.id).map((child) => branch(child, depth + 1))}</ul>
      </li>
    );

  return (
    <Dialog open onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{nodes.length === 1 ? `„${nodes[0].name}“ verschieben nach` : `${nodes.length} Elemente verschieben nach`}</DialogTitle>
        </DialogHeader>
        <ul className="max-h-80 overflow-auto rounded-lg border p-1">
          <li>
            {row(null, rootName, 0)}
            <ul>{children(null).map((child) => branch(child, 1))}</ul>
          </li>
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Abbrechen
          </Button>
          <Button disabled={target === undefined} onClick={() => target !== undefined && onMove(target)}>
            Verschieben
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
