"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Ellipsis, LoaderCircle, Mail, ShieldCheck, ShieldOff, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { UserMenu } from "@/components/user-menu";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth-client";

type User = { id: string; email: string; role?: string | null; emailVerified: boolean };

export function Users() {
  const queryClient = useQueryClient();
  const session = authClient.useSession();
  const [email, setEmail] = useState("");
  const [removing, setRemoving] = useState<User | null>(null);
  const isAdmin = session.data?.user.role === "admin";

  const users = useQuery({
    queryKey: ["users"],
    enabled: isAdmin,
    queryFn: async () => {
      const result = await authClient.admin.listUsers({ query: { limit: 500, sortBy: "email", sortDirection: "asc" } });
      if (result.error) throw new Error("Die Nutzer lassen sich nicht laden");
      return result.data.users as User[];
    },
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["users"] });

  const invite = useMutation({
    mutationFn: (address: string) => api.invite(address),
    onSuccess: (_data, address) => {
      toast.success(`Einladung an ${address} gesendet`);
      setEmail("");
      refresh();
    },
    onError: (error) => toast.error(error.message),
  });
  const setRole = useMutation({
    mutationFn: async ({ user, role }: { user: User; role: "admin" | "user" }) => {
      const result = await authClient.admin.setRole({ userId: user.id, role });
      if (result.error) throw new Error("Die Rolle lässt sich nicht ändern");
    },
    onSuccess: refresh,
    onError: (error) => toast.error(error.message),
  });
  const remove = useMutation({
    mutationFn: async (user: User) => {
      const result = await authClient.admin.removeUser({ userId: user.id });
      if (result.error) throw new Error(`${user.email} lässt sich nicht entfernen`);
    },
    onSuccess: refresh,
    onError: (error) => toast.error(error.message),
  });

  return (
    <main className="flex min-h-dvh flex-col">
      <header className="flex h-12 shrink-0 items-center gap-1 border-b px-3">
        <Button variant="ghost" size="icon" aria-label="Zurück zu den Rechnungen" nativeButton={false} render={<Link href="/" />}>
          <ArrowLeft />
        </Button>
        <h1 className="flex-1 text-sm font-medium">Nutzer</h1>
        <UserMenu />
      </header>

      <div className="mx-auto w-full max-w-2xl space-y-6 p-6">
        {session.data && !isAdmin ? (
          <p className="text-sm text-muted-foreground">Nur Administratoren verwalten Nutzer.</p>
        ) : (
          <>
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                invite.mutate(email.trim());
              }}
            >
              <Input type="email" required placeholder="name@firma.de" aria-label="E-Mail-Adresse" value={email} onChange={(event) => setEmail(event.target.value)} />
              <Button type="submit" disabled={invite.isPending}>
                {invite.isPending ? <LoaderCircle className="animate-spin" /> : <Mail />} Einladen
              </Button>
            </form>

            <ul className="divide-y rounded-xl border">
              {users.data?.map((user) => {
                const self = user.id === session.data?.user.id;
                return (
                  <li key={user.id} className="flex h-12 items-center gap-3 px-4 text-sm">
                    <span className="min-w-0 flex-1 truncate">{user.email}</span>
                    {!user.emailVerified && <span className="text-muted-foreground">Eingeladen</span>}
                    {user.role === "admin" && <span className="text-muted-foreground">Admin</span>}
                    {self ? (
                      <span className="w-8 text-center text-muted-foreground">Du</span>
                    ) : (
                      <DropdownMenu>
                        <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={`Aktionen für ${user.email}`} />}>
                          <Ellipsis />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="min-w-56">
                          {!user.emailVerified && (
                            <DropdownMenuItem onClick={() => invite.mutate(user.email)}>
                              <Mail /> Einladung erneut senden
                            </DropdownMenuItem>
                          )}
                          {user.role === "admin" ? (
                            <DropdownMenuItem onClick={() => setRole.mutate({ user, role: "user" })}>
                              <ShieldOff /> Adminrechte entziehen
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem onClick={() => setRole.mutate({ user, role: "admin" })}>
                              <ShieldCheck /> Zum Admin machen
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="destructive" onClick={() => setRemoving(user)}>
                            <Trash2 /> Entfernen
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>

      <AlertDialog open={removing !== null} onOpenChange={(isOpen) => !isOpen && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{removing?.email} entfernen?</AlertDialogTitle>
            <AlertDialogDescription>Die Person kann sich danach nicht mehr anmelden. Ihre hochgeladenen Rechnungen bleiben erhalten.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (removing) remove.mutate(removing);
                setRemoving(null);
              }}
            >
              Entfernen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
