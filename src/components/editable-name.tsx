"use client";

import { PenLine } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Node } from "@/lib/nodes";
import { cn } from "@/lib/utils";

type RenameInputProps = {
  name: string;
  kind: Node["kind"];
  className?: string;
  /** The typed name, or null when the user pressed Escape. */
  onDone: (name: string | null) => void;
};

export function RenameInput({ name, kind, className, onDone }: RenameInputProps) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    const input = ref.current!;
    input.focus();
    // Leave the extension unselected so typing replaces only the name.
    const dot = kind === "file" ? name.lastIndexOf(".") : -1;
    input.setSelectionRange(0, dot > 0 ? dot : name.length);
  }, [name, kind]);

  const finish = (value: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(value);
  };

  return (
    <input
      ref={ref}
      defaultValue={name}
      aria-label="Name"
      className={cn("h-7 min-w-0 flex-1 rounded-md border border-ring bg-background px-1.5 text-sm outline-none ring-2 ring-ring/30", className)}
      onClick={(event) => event.stopPropagation()}
      onBlur={(event) => finish(event.target.value)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") finish(event.currentTarget.value);
        if (event.key === "Escape") finish(null);
      }}
    />
  );
}

type EditableNameProps = {
  name: string;
  kind: Node["kind"];
  /** Called with the trimmed new name, only when it differs from the current one. */
  onRename: (name: string) => void;
  /** How the name shows when not editing. */
  children: React.ReactNode;
};

/** A name with a pencil that appears on hover. The pencil swaps the name for a text field. */
export function EditableName({ name, kind, onRename, children }: EditableNameProps) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <RenameInput
        name={name}
        kind={kind}
        className="max-w-96"
        onDone={(value) => {
          setEditing(false);
          const trimmed = value?.trim();
          if (trimmed && trimmed !== name) onRename(trimmed);
        }}
      />
    );
  }

  return (
    <div className="group/name flex min-w-0 items-center gap-0.5">
      {children}
      <button
        type="button"
        title="Umbenennen"
        aria-label={`${name} umbenennen`}
        onClick={() => setEditing(true)}
        // Touch screens have no hover, so the pencil stays visible there.
        className="shrink-0 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity group-hover/name:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [@media(hover:none)]:opacity-100"
      >
        <PenLine className="size-3.5" />
      </button>
    </div>
  );
}
