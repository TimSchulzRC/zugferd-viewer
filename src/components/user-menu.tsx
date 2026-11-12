"use client";

import { LogOut, UserRound, Users } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { reload } from "@/lib/api";
import { authClient } from "@/lib/auth-client";

export function UserMenu() {
  const { data } = authClient.useSession();
  if (!data) return <div className="size-8" />;

  const signOut = async () => {
    await authClient.signOut();
    reload("/login");
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label="Konto" />}>
        <UserRound />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{data.user.email}</DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {data.user.role === "admin" && (
          <DropdownMenuItem render={<Link href="/nutzer" />}>
            <Users /> Nutzer
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={signOut}>
          <LogOut /> Abmelden
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
