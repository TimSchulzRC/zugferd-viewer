"use client";

import { useQuery } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import { parseAsString, useQueryStates } from "nuqs";
import { useState } from "react";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { reload } from "@/lib/api";
import { authClient } from "@/lib/auth-client";

/** Where the client wants the user to go after agreeing: its host, so a strange one stands out. */
function host(uri: string | null) {
  if (!uri) return null;
  try {
    return new URL(uri).host || uri;
  } catch {
    return uri;
  }
}

/**
 * An MCP client such as Claude Code asks to read the user's files. Better Auth sends the user here
 * after sign-in with a signed request in the address; agreeing or refusing returns to the client.
 */
export function Consent() {
  const [query] = useQueryStates({ client_id: parseAsString, redirect_uri: parseAsString });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const session = authClient.useSession();
  const client = useQuery({
    queryKey: ["oauth-client", query.client_id],
    enabled: !!query.client_id,
    queryFn: async () => {
      const response = await fetch(`/api/auth/oauth2/public-client?client_id=${encodeURIComponent(query.client_id!)}`);
      if (!response.ok) throw new Error("Unbekannte Anwendung");
      return (await response.json()) as { client_name?: string };
    },
  });

  const answer = async (accept: boolean) => {
    setBusy(true);
    setError(null);
    const result = await authClient.oauth2.consent({ accept });
    const next = (result.data as { url?: unknown } | null)?.url;
    if (result.error || typeof next !== "string") {
      setBusy(false);
      return setError("Die Anfrage ist abgelaufen. Starte die Verbindung in deiner Anwendung neu.");
    }
    reload(next);
  };

  const name = client.data?.client_name || "Eine Anwendung";
  const target = host(query.redirect_uri);

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <h1 className="flex items-center gap-3 font-heading text-2xl font-semibold">
          <Logo className="size-9 shrink-0" /> ZUGFeRD Viewer
        </h1>
        {!query.client_id || client.isError ? (
          <p role="alert" className="text-sm text-destructive">
            Diese Anfrage ist ungültig. Starte die Verbindung in deiner Anwendung neu.
          </p>
        ) : (
          <>
            <div className="space-y-2 text-sm">
              <p>
                <strong>{client.isPending ? "…" : name}</strong> möchte in deinem Namen lesen, was du hier sehen darfst: deine Ordner, was andere mit dir teilen, die
                Dateien und ihre Prüfergebnisse.
              </p>
              <p className="text-muted-foreground">
                Ändern, hochladen oder löschen kann die Anwendung nichts. Sie darf Rechnungen, die sie selbst mitbringt, prüfen lassen; die werden nirgends gespeichert.
                {session.data && <> Angemeldet als {session.data.user.email}.</>}
                {target && <> Danach geht es weiter zu {target}.</>}
              </p>
            </div>
            <div className="flex gap-2">
              <Button className="flex-1" onClick={() => answer(true)} disabled={busy || client.isPending}>
                {busy && <LoaderCircle className="animate-spin" />} Erlauben
              </Button>
              <Button variant="outline" className="flex-1" onClick={() => answer(false)} disabled={busy}>
                Ablehnen
              </Button>
            </div>
          </>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
