"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Eye, Mail, PenLine, Share2, Trash2, UserRound, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
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

const EVERYONE = "*";

type Level = "view" | "edit";
const LEVELS: Record<Level, { label: string; hint: string; icon: typeof Eye }> = {
  view: { label: "Ansehen", hint: "Öffnen und herunterladen", icon: Eye },
  edit: { label: "Bearbeiten", hint: "Auch hochladen, umbenennen, löschen", icon: PenLine },
};

function LevelSelect({ value, onChange, label }: { value: Level; onChange: (level: Level) => void; label: string }) {
  return (
    <Select items={{ view: LEVELS.view.label, edit: LEVELS.edit.label }} value={value} onValueChange={(next) => next && onChange(next as Level)}>
      <SelectTrigger aria-label={label} className="w-36 bg-background">
        <SelectValue>
          {(current: Level) => {
            const { icon: Icon, label: text } = LEVELS[current];
            return (
              <>
                <Icon className="text-muted-foreground" /> {text}
              </>
            );
          }}
        </SelectValue>
      </SelectTrigger>
      <SelectContent align="end" alignItemWithTrigger={false} className="min-w-72">
        {(Object.keys(LEVELS) as Level[]).map((key) => {
          const { icon: Icon, label: text, hint } = LEVELS[key];
          return (
            <SelectItem key={key} value={key} className="items-start py-1.5">
              <Icon className="mt-0.5 text-muted-foreground" />
              <span className="flex flex-col">
                <span>{text}</span>
                <span className="text-xs text-muted-foreground">{hint}</span>
              </span>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}

/** Everyone first, then the people with an account, each with their own icon. */
function PersonSelect({ value, onChange, everyone, people }: { value: string; onChange: (id: string) => void; everyone: boolean; people: { id: string; email: string }[] }) {
  const items = [...(everyone ? [{ value: EVERYONE, label: "Alle Nutzer" }] : []), ...people.map((person) => ({ value: person.id, label: person.email }))];
  return (
    <Select items={items} value={value} onValueChange={(next) => next && onChange(next)}>
      <SelectTrigger aria-label="Mit wem teilen" className="min-w-0 flex-1 basis-48 bg-background">
        <SelectValue>
          {(current: string) => (
            <>
              {current === EVERYONE ? <Users className="text-muted-foreground" /> : <UserRound className="text-muted-foreground" />}
              <span className="truncate">{items.find((item) => item.value === current)?.label}</span>
            </>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} className="max-h-72">
        {everyone && (
          <SelectGroup>
            <SelectItem value={EVERYONE}>
              <Users className="text-muted-foreground" /> Alle Nutzer
            </SelectItem>
          </SelectGroup>
        )}
        {everyone && people.length > 0 && <SelectSeparator />}
        {people.length > 0 && (
          <SelectGroup>
            <SelectLabel>Personen</SelectLabel>
            {people.map((person) => (
              <SelectItem key={person.id} value={person.id}>
                <UserRound className="text-muted-foreground" /> <span className="truncate">{person.email}</span>
              </SelectItem>
            ))}
          </SelectGroup>
        )}
      </SelectContent>
    </Select>
  );
}

function PermissionRow({ permission, onChange, onDelete }: { permission: Permission; onChange: (canEdit: boolean) => void; onDelete: () => void }) {
  const label = permission.userId === null ? "Alle Nutzer" : permission.email;
  return (
    <li className="flex items-center gap-2 rounded-lg border p-2">
      {permission.userId === null ? <Users className="size-4 shrink-0 text-muted-foreground" /> : <UserRound className="size-4 shrink-0 text-muted-foreground" />}
      <p className="min-w-0 flex-1 truncate font-medium">{label}</p>
      <LevelSelect label={`Rechte für ${label}`} value={permission.canEdit ? "edit" : "view"} onChange={(level) => onChange(level === "edit")} />
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
  const [level, setLevel] = useState<Level>("view");

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
  const everyone = !taken.has(EVERYONE);
  const people = (colleagues.data ?? []).filter((person) => !taken.has(person.id));
  const choices = [...(everyone ? [EVERYONE] : []), ...people.map((person) => person.id)];
  const chosen = choices.includes(who) ? who : choices[0];

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
          <PersonSelect value={chosen} onChange={setWho} everyone={everyone} people={people} />
          <LevelSelect label="Rechte" value={level} onChange={setLevel} />
          <Button type="submit" disabled={!chosen || grant.isPending}>
            {taken.size > 0 ? <Users /> : <Share2 />} Teilen
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
