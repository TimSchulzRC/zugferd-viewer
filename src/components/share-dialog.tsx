"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Mail, Trash2, UserRound, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, shareUrl } from "@/lib/api";
import type { Node, Permission, Share } from "@/lib/nodes";
import { cn } from "@/lib/utils";

const dayFormat = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" });

/** navigator.clipboard only exists on https and localhost; over plain http on the LAN the old way still works. */
async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const field = document.createElement("textarea");
    field.value = text;
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.append(field);
    field.select();
    const copied = document.execCommand("copy");
    field.remove();
    if (!copied) throw new Error("Kopieren nicht möglich");
  }
}

function copyLink(share: Share) {
  copy(shareUrl(share.token)).then(
    () => toast.success("Link kopiert"),
    () => toast.error("Kopieren nicht möglich. Bitte den Link markieren und selbst kopieren."),
  );
}

function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function ShareRow({ share, onDelete }: { share: Share; onDelete: () => void }) {
  const url = shareUrl(share.token);
  const facts = [
    share.expired ? "abgelaufen" : share.expiresOn ? `gültig bis ${dayFormat.format(new Date(`${share.expiresOn}T00:00`))}` : "ohne Ablaufdatum",
    share.createdBy && `geteilt von ${share.createdBy}`,
  ].filter(Boolean);

  return (
    <li className={cn("flex items-center gap-2 rounded-lg border p-2", share.expired && "opacity-60")}>
      <Mail className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{share.email}</p>
        <p className="truncate text-xs text-muted-foreground">{facts.join(" · ")}</p>
        <input
          readOnly
          value={url}
          aria-label="Link"
          onFocus={(event) => event.currentTarget.select()}
          className="w-full truncate bg-transparent font-mono text-xs text-muted-foreground outline-none"
        />
      </div>
      <Button variant="ghost" size="icon-sm" aria-label="Link kopieren" disabled={share.expired} onClick={() => copyLink(share)}>
        <Copy />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Link löschen" onClick={onDelete}>
        <Trash2 />
      </Button>
    </li>
  );
}

const SELECT = "h-8 w-full min-w-0 rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const EVERYONE = "*";

function PermissionRow({ permission, onChange, onDelete }: { permission: Permission; onChange: (canEdit: boolean) => void; onDelete: () => void }) {
  const label = permission.userId === null ? "Alle Nutzer" : permission.email;
  return (
    <li className="flex items-center gap-2 rounded-lg border p-2">
      {permission.userId === null ? <Users className="size-4 shrink-0 text-muted-foreground" /> : <UserRound className="size-4 shrink-0 text-muted-foreground" />}
      <p className="min-w-0 flex-1 truncate font-medium">{label}</p>
      <select aria-label={`Rechte für ${label}`} className={cn(SELECT, "w-32")} value={permission.canEdit ? "edit" : "view"} onChange={(event) => onChange(event.target.value === "edit")}>
        <option value="view">Ansehen</option>
        <option value="edit">Bearbeiten</option>
      </select>
      <Button variant="ghost" size="icon-sm" aria-label={`Freigabe für ${label} beenden`} onClick={onDelete}>
        <Trash2 />
      </Button>
    </li>
  );
}

/** Sharing with people who have an account: everyone, or chosen colleagues, to view or to edit. */
function Colleagues({ node }: { node: Node }) {
  const queryClient = useQueryClient();
  const permissions = useQuery({ queryKey: ["permissions", node.id], queryFn: () => api.permissions(node.id) });
  const colleagues = useQuery({ queryKey: ["colleagues"], queryFn: api.colleagues });
  const [who, setWho] = useState(EVERYONE);
  const [level, setLevel] = useState<"view" | "edit">("view");

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["permissions", node.id] });
    queryClient.invalidateQueries({ queryKey: ["nodes"] });
  };
  const grant = useMutation({
    mutationFn: (input: { userId: string | null; canEdit: boolean }) => api.grant(node.id, input),
    onSuccess: (permission) => {
      refresh();
      toast.success(`Geteilt mit ${permission.email ?? "allen Nutzern"}`);
    },
    onError: (error) => toast.error(error.message),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.revoke(id),
    onSuccess: () => {
      refresh();
      toast.success("Freigabe beendet");
    },
    onError: (error) => toast.error(error.message),
  });

  const taken = new Set(permissions.data?.map((permission) => permission.userId ?? EVERYONE));
  const choices = [{ id: EVERYONE, email: "Alle Nutzer" }, ...(colleagues.data ?? [])].filter((choice) => !taken.has(choice.id));
  const chosen = choices.some((choice) => choice.id === who) ? who : choices[0]?.id;

  return (
    <section className="flex flex-col gap-3">
      <p className="font-medium">Mit Nutzern dieser App teilen</p>
      {permissions.data && permissions.data.length > 0 && (
        <ul className="flex max-h-56 flex-col gap-2 overflow-auto">
          {permissions.data.map((permission) => (
            <PermissionRow
              key={permission.id}
              permission={permission}
              onChange={(canEdit) => grant.mutate({ userId: permission.userId, canEdit })}
              onDelete={() => revoke.mutate(permission.id)}
            />
          ))}
        </ul>
      )}
      {choices.length > 0 && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (chosen) grant.mutate({ userId: chosen === EVERYONE ? null : chosen, canEdit: level === "edit" });
          }}
        >
          <select aria-label="Mit wem teilen" className={cn(SELECT, "flex-1 basis-48")} value={chosen} onChange={(event) => setWho(event.target.value)}>
            {choices.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.email}
              </option>
            ))}
          </select>
          <select aria-label="Rechte" className={cn(SELECT, "w-32")} value={level} onChange={(event) => setLevel(event.target.value as "view" | "edit")}>
            <option value="view">Ansehen</option>
            <option value="edit">Bearbeiten</option>
          </select>
          <Button type="submit" disabled={!chosen || grant.isPending}>
            <Users /> Teilen
          </Button>
        </form>
      )}
      <p className="text-xs text-muted-foreground">
        {node.kind === "folder" ? "Gilt für alles in diesem Ordner. " : ""}Ansehen heißt öffnen und herunterladen. Bearbeiten erlaubt außerdem Hochladen, Umbenennen, Verschieben und Löschen
        {node.kind === "folder" ? " darin" : ""}. Teilen kann nur, wem es gehört.
      </p>
    </section>
  );
}

export function ShareDialog({ node, onClose }: { node: Node; onClose: () => void }) {
  const queryClient = useQueryClient();
  const shares = useQuery({ queryKey: ["shares", node.id], queryFn: () => api.shares(node.id) });
  const [email, setEmail] = useState("");
  const [expiresOn, setExpiresOn] = useState("");

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["shares", node.id] });
    // The shared marker in the file list.
    queryClient.invalidateQueries({ queryKey: ["nodes"] });
  };

  const create = useMutation({
    mutationFn: () => api.createShare(node.id, { email, expiresOn: expiresOn || null }),
    onSuccess: (share) => {
      refresh();
      setEmail("");
      setExpiresOn("");
      toast.success(`Link an ${share.email} geschickt`);
    },
    onError: (error) => toast.error(error.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteShare(id),
    onSuccess: () => {
      refresh();
      toast.success("Freigabe beendet. Der Link funktioniert nicht mehr.");
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <Dialog open onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>„{node.name}“ teilen</DialogTitle>
          <DialogDescription>Ohne Freigabe siehst nur du {node.kind === "folder" ? "diesen Ordner" : "diese Datei"}.</DialogDescription>
        </DialogHeader>

        <Colleagues node={node} />

        <section className="flex flex-col gap-3 border-t pt-4">
          <p className="font-medium">Mit einer Person außerhalb teilen</p>
          <p className="text-xs text-muted-foreground">
            Die Person bekommt einen Link per E-Mail. Beim Öffnen schicken wir ihr einen Code an genau diese Adresse, ein weitergeleiteter Link nützt also niemandem. Sie
            kann {node.kind === "folder" ? "den Ordner mit allem darin" : "die Datei"} ansehen und herunterladen, aber nichts ändern.
          </p>
          {shares.data && shares.data.length > 0 && (
            <ul className="flex max-h-48 flex-col gap-2 overflow-auto">
              {shares.data.map((share) => (
                <ShareRow key={share.id} share={share} onDelete={() => remove.mutate(share.id)} />
              ))}
            </ul>
          )}
          <form
            className="flex flex-col gap-3 rounded-lg bg-muted/50 p-3"
            onSubmit={(event) => {
              event.preventDefault();
              create.mutate();
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="share-email">E-Mail-Adresse</Label>
                <Input id="share-email" type="email" required value={email} autoComplete="off" onChange={(event) => setEmail(event.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="share-expires">Gültig bis (optional)</Label>
                <Input id="share-expires" type="date" min={today()} value={expiresOn} onChange={(event) => setExpiresOn(event.target.value)} />
              </div>
            </div>
            <Button type="submit" disabled={!email || create.isPending} className="self-end">
              <Mail /> Teilen und Link senden
            </Button>
          </form>
        </section>
      </DialogContent>
    </Dialog>
  );
}
