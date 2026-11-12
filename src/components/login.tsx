"use client";

import { useQuery } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import { parseAsString, useQueryStates } from "nuqs";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Label } from "@/components/ui/label";
import { reload } from "@/lib/api";
import { authClient } from "@/lib/auth-client";

function MicrosoftLogo() {
  return (
    <svg viewBox="0 0 21 21" className="size-4" aria-hidden>
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

export function Login() {
  // `error` is set by Better Auth when the Microsoft account belongs to nobody who was invited.
  const [query] = useQueryStates({ email: parseAsString.withDefault(""), error: parseAsString });
  const [email, setEmail] = useState(query.email);
  const [step, setStep] = useState<"email" | "code">("email");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(query.error ? "Dieses Microsoft-Konto ist nicht eingeladen." : null);
  const config = useQuery({ queryKey: ["config"], queryFn: () => fetch("/api/config").then((r) => r.json() as Promise<{ microsoft: boolean }>) });

  const sendCode = async (event?: React.FormEvent) => {
    event?.preventDefault();
    setBusy(true);
    setError(null);
    const result = await authClient.emailOtp.sendVerificationOtp({ email: email.trim(), type: "sign-in" });
    setBusy(false);
    if (result.error) return setError("Der Code konnte nicht gesendet werden.");
    setCode("");
    setStep("code");
  };

  const signIn = async (otp: string) => {
    setBusy(true);
    setError(null);
    const result = await authClient.signIn.emailOtp({ email: email.trim(), otp });
    if (result.error) {
      setBusy(false);
      setCode("");
      return setError(result.error.code === "TOO_MANY_ATTEMPTS" ? "Zu viele Versuche. Fordere einen neuen Code an." : "Der Code stimmt nicht.");
    }
    reload("/");
  };

  const microsoft = () => authClient.signIn.social({ provider: "microsoft", callbackURL: "/", errorCallbackURL: "/login" });

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <h1 className="font-heading text-2xl font-semibold">ZUGFeRD Viewer</h1>

        {step === "email" ? (
          <form onSubmit={sendCode} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="email">E-Mail</Label>
              <Input id="email" type="email" autoComplete="email" autoFocus required value={email} onChange={(event) => setEmail(event.target.value)} />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy && <LoaderCircle className="animate-spin" />} Code per E-Mail senden
            </Button>
          </form>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="code">Code aus der E-Mail an {email.trim()}</Label>
              <InputOTP id="code" maxLength={6} autoFocus value={code} onChange={setCode} onComplete={signIn} disabled={busy} inputMode="numeric">
                <InputOTPGroup>
                  {[0, 1, 2, 3, 4, 5].map((index) => (
                    <InputOTPSlot key={index} index={index} className="size-11 text-lg" />
                  ))}
                </InputOTPGroup>
              </InputOTP>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => sendCode()} disabled={busy}>
                Neuen Code senden
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setStep("email")} disabled={busy}>
                Andere E-Mail
              </Button>
            </div>
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        {config.data?.microsoft && step === "email" && (
          <>
            <div className="flex items-center gap-3 text-xs text-muted-foreground before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">oder</div>
            <Button variant="outline" className="w-full" onClick={microsoft}>
              <MicrosoftLogo /> Mit Microsoft anmelden
            </Button>
          </>
        )}
      </div>
    </main>
  );
}
