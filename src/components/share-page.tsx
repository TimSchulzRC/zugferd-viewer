"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Download, FileText, Folder, KeyRound, LoaderCircle, Mail } from "lucide-react";
import { useParams } from "next/navigation";
import { parseAsString, useQueryStates } from "nuqs";
import { useMemo, useState } from "react";
import { DEV_CODE } from "@/lib/dev";
import { dateFormat, FormatCell, formatSize, STATUS } from "@/components/file-manager";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Viewer } from "@/components/viewer";
import { ApiError, shareApi, shareSource } from "@/lib/api";
import type { Node } from "@/lib/nodes";
import { cn } from "@/lib/utils";

const GRID =
  "grid grid-cols-[minmax(0,1fr)_9rem_5.5rem] @xl:grid-cols-[minmax(0,1fr)_5.5rem_9rem_5.5rem] @2xl:grid-cols-[minmax(0,1fr)_5.5rem_9rem_5.5rem_10rem] items-center gap-3 px-4";
const dayFormat = new Intl.DateTimeFormat("de-DE", { dateStyle: "long" });

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center text-sm">
      <Logo className="size-10" />
      {children}
    </main>
  );
}

function CodeForm({ token, email }: { token: string; email: string }) {
  const queryClient = useQueryClient();
  const share = shareApi(token);
  const [code, setCode] = useState("");
  // Stays true after a failed resend, so the code already in the mailbox can still be entered.
  const [sent, setSent] = useState(false);
  const unlock = useMutation({
    mutationFn: (value: string) => share.unlock(value),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["share", token] }),
  });

  const send = useMutation({
    mutationFn: share.requestCode,
    onSuccess: () => {
      setSent(true);
      if (DEV_CODE) {
        setCode(DEV_CODE);
        unlock.mutate(DEV_CODE);
      }
    },
  });

  if (!sent) {
    return (
      <Centered>
        <div className="flex max-w-sm flex-col gap-1">
          <h1 className="text-base font-medium">Rechnungen wurden mit dir geteilt</h1>
          <p className="text-muted-foreground">
            Damit nur du sie siehst, schicken wir dir einen Code an <span className="font-medium text-foreground">{email}</span>.
          </p>
        </div>
        <Button onClick={() => send.mutate()} disabled={send.isPending}>
          <Mail /> Code senden
        </Button>
        {send.isError && <p className="text-destructive">{send.error.message}</p>}
      </Centered>
    );
  }

  return (
    <Centered>
      <div className="flex max-w-sm flex-col gap-1">
        <h1 className="text-base font-medium">Code eingeben</h1>
        <p className="text-muted-foreground">Wir haben dir einen Code an {email} geschickt. Er gilt 10 Minuten.</p>
      </div>
      <form
        className="flex w-full max-w-xs flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          unlock.mutate(code);
        }}
      >
        <Input
          autoFocus
          inputMode="numeric"
          autoComplete="one-time-code"
          aria-label="Code"
          placeholder="123456"
          maxLength={6}
          value={code}
          aria-invalid={unlock.isError || undefined}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
          className="text-center font-mono tracking-[0.4em]"
        />
        {unlock.isError && <p className="text-left text-destructive">{unlock.error.message}</p>}
        {send.isError && <p className="text-left text-destructive">{send.error.message}</p>}
        <Button type="submit" disabled={code.length !== 6 || unlock.isPending}>
          <KeyRound /> Öffnen
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={send.isPending}
          onClick={() => {
            setCode("");
            unlock.reset();
            send.mutate();
          }}
        >
          Neuen Code senden
        </Button>
      </form>
    </Centered>
  );
}

function SharedFolder({ token, name, rootId, expiresOn }: { token: string; name: string; rootId: string; expiresOn: string | null }) {
  const [{ ordner }, setQuery] = useQueryStates({ ordner: parseAsString, datei: parseAsString }, { history: "push" });
  const share = shareApi(token);
  const source = shareSource(token);
  const listing = useQuery({ queryKey: ["share", token, "nodes", ordner], queryFn: () => share.list(ordner) });

  const items = useMemo(
    () =>
      [...(listing.data?.items ?? [])].sort((a, b) =>
        a.kind !== b.kind ? (a.kind === "folder" ? -1 : 1) : a.name.localeCompare(b.name, "de", { numeric: true, sensitivity: "base" }),
      ),
    [listing.data],
  );
  const crumbs = [{ id: null as string | null, name }, ...(listing.data?.path ?? [])];
  const open = (node: Node) => setQuery(node.kind === "folder" ? { ordner: node.id } : { datei: node.id });

  return (
    <main className="flex h-dvh flex-col">
      <header className="shrink-0 border-b">
        <div className="mx-auto flex h-12 w-full max-w-6xl items-center gap-2 px-3">
          <Logo className="size-6 shrink-0" />
          <nav aria-label="Pfad" className="flex min-w-0 flex-1 items-center gap-0.5 text-sm">
            {crumbs.map((crumb, index) => {
              const last = index === crumbs.length - 1;
              return (
                <div key={crumb.id ?? "root"} className="flex min-w-0 items-center gap-0.5">
                  {index > 0 && <ChevronRight className="size-4 shrink-0 text-muted-foreground" />}
                  <button
                    type="button"
                    aria-current={last ? "page" : undefined}
                    onClick={() => setQuery({ ordner: crumb.id })}
                    className={cn("truncate rounded-md px-1.5 py-1 hover:bg-muted", last ? "font-medium" : "text-muted-foreground")}
                  >
                    {crumb.name}
                  </button>
                </div>
              );
            })}
          </nav>
          <Button size="sm" onClick={() => source.download([ordner ?? rootId])}>
            <Download /> {ordner ? "Ordner herunterladen" : "Alles herunterladen"}
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="@container mx-auto w-full max-w-6xl">
          <div role="row" className={cn(GRID, "sticky top-0 z-10 h-9 border-b bg-background text-xs text-muted-foreground")}>
            <span>Name</span>
            <span className="hidden @xl:block">Format</span>
            <span>Prüfung</span>
            <span className="text-right">Größe</span>
            <span className="hidden @2xl:block">Geändert</span>
          </div>
          {items.map((node) => {
            const status = node.status ? STATUS[node.status] : null;
            return (
              <div key={node.id} role="row" onClick={() => open(node)} className={cn(GRID, "group h-10 cursor-pointer border-b text-sm hover:bg-muted/50")}>
                <div className="flex min-w-0 items-center gap-2.5">
                  {node.kind === "folder" ? <Folder className="size-4 shrink-0 fill-sky-500/20 text-sky-600" /> : <FileText className="size-4 shrink-0 text-muted-foreground" />}
                  <span className="truncate">{node.name}</span>
                  <button
                    type="button"
                    aria-label={`${node.name} herunterladen`}
                    onClick={(event) => {
                      event.stopPropagation();
                      source.download([node.id]);
                    }}
                    className="ml-auto shrink-0 rounded p-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100"
                  >
                    <Download className="size-4" />
                  </button>
                </div>
                <FormatCell node={node} />
                <div className="flex items-center gap-1.5 whitespace-nowrap">
                  {status && (
                    <>
                      <status.icon className={cn("size-4 shrink-0", status.color)} /> {status.label}
                    </>
                  )}
                </div>
                <div className="text-right text-muted-foreground tabular-nums">{node.size !== null && formatSize(node.size)}</div>
                <div className="hidden whitespace-nowrap text-muted-foreground @2xl:block">{dateFormat.format(new Date(node.updatedAt))}</div>
              </div>
            );
          })}
          {listing.isSuccess && items.length === 0 && <p className="px-6 py-24 text-center text-sm text-muted-foreground">Dieser Ordner ist leer.</p>}
          {listing.isError && <p className="px-6 py-24 text-center text-sm">{listing.error.message}</p>}
          {expiresOn && <p className="px-4 py-3 text-xs text-muted-foreground">Dieser Link gilt bis {dayFormat.format(new Date(`${expiresOn}T00:00`))}.</p>}
        </div>
      </div>
    </main>
  );
}

/** What someone without an account sees under /s/<token>: the code check, a read-only folder, or the viewer. */
export function SharePage() {
  const { token } = useParams<{ token: string }>();
  const [{ datei }] = useQueryStates({ datei: parseAsString });
  const info = useQuery({ queryKey: ["share", token], queryFn: () => shareApi(token).info(), retry: false });

  if (info.isPending) {
    return (
      <Centered>
        <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
      </Centered>
    );
  }
  if (info.isError) {
    return (
      <Centered>
        <h1 className="text-base font-medium">{info.error instanceof ApiError && info.error.status === 404 ? "Link ungültig" : "Das hat nicht geklappt"}</h1>
        <p className="max-w-sm text-muted-foreground">{info.error.message}</p>
      </Centered>
    );
  }
  const data = info.data;
  if (data.locked) return <CodeForm token={token} email={data.email} />;
  if (data.kind === "file") return <Viewer id={data.rootId} source={shareSource(token)} canGoBack={false} />;
  if (datei) return <Viewer key={datei} id={datei} source={shareSource(token)} />;
  return <SharedFolder token={token} name={data.name} rootId={data.rootId} expiresOn={data.expiresOn} />;
}
