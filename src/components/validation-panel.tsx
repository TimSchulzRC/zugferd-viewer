"use client";

import { CircleAlert, CircleCheck, CircleX, Info, LoaderCircle, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { describeProfile, type Finding, type Report } from "@/lib/report";
import { describeTerm } from "@/lib/terms";
import { cn } from "@/lib/utils";

export type Validation = { state: "loading" } | { state: "failed"; message: string } | { state: "done"; report: Report };

const SEVERITY = {
  error: { title: "Fehler", icon: CircleX, color: "text-red-600" },
  warning: { title: "Warnungen", icon: TriangleAlert, color: "text-amber-600" },
  notice: { title: "Hinweise", icon: Info, color: "text-sky-600" },
} as const;

function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  const Icon = ok ? CircleCheck : CircleX;
  return (
    <li className="flex items-center gap-2">
      <Icon className={cn("size-4 shrink-0", ok ? "text-emerald-600" : "text-red-600")} />
      {children}
    </li>
  );
}

function FindingRow({ finding, onLocate }: { finding: Finding; onLocate?: () => void }) {
  const content = (
    <>
      {finding.terms.length > 0 && (
        <span className="mb-1 flex flex-wrap gap-x-3 gap-y-0.5">
          {finding.terms.map((id) => (
            <span key={id} className="flex items-baseline gap-1.5">
              <span className="shrink-0 rounded bg-foreground px-1 font-mono whitespace-nowrap text-[11px] font-medium text-background">{id}</span>
              <span className="font-medium">{describeTerm(id)}</span>
            </span>
          ))}
        </span>
      )}
      <span className="block text-muted-foreground">{finding.message}</span>
      {finding.rule && <span className="mt-0.5 block font-mono text-[11px] text-muted-foreground/80">{finding.rule}</span>}
    </>
  );
  const className = "block w-full px-4 py-2.5 text-left text-sm [overflow-wrap:anywhere]";
  return (
    <li className="border-b last:border-0">
      {onLocate ? (
        <button type="button" onClick={onLocate} className={cn(className, "hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none")}>
          {content}
        </button>
      ) : (
        <div className={className}>{content}</div>
      )}
    </li>
  );
}

type Props = {
  validation: Validation;
  onRetry: () => void;
  /** Returns a jump-to-XML action for findings that point at an element in the file. */
  locate: (finding: Finding) => (() => void) | undefined;
};

export function ValidationPanel({ validation, onRetry, locate }: Props) {
  if (validation.state === "loading") {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" /> Rechnung wird geprüft
      </div>
    );
  }
  if (validation.state === "failed") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm">
        <CircleAlert className="size-6 text-muted-foreground" />
        <p>{validation.message}</p>
        <Button variant="outline" size="sm" onClick={onRetry}>
          Erneut prüfen
        </Button>
      </div>
    );
  }

  const { report } = validation;
  const profile = describeProfile(report.profile);
  const count = (severity: Finding["severity"]) => report.findings.filter((f) => f.severity === severity).length;
  const eInvoice = report.valid && !!profile?.en16931;

  const verdict = eInvoice
    ? { title: "Gültige E-Rechnung", tone: "bg-emerald-600/10 text-emerald-800 dark:text-emerald-300", icon: CircleCheck }
    : report.valid
      ? { title: "Gültig, aber keine E-Rechnung", tone: "bg-amber-500/15 text-amber-800 dark:text-amber-300", icon: TriangleAlert }
      : { title: "Ungültig", tone: "bg-red-600/10 text-red-800 dark:text-red-300", icon: CircleX };

  return (
    <div className="h-full overflow-auto">
      <div className={cn("flex items-center gap-2.5 px-4 py-3", verdict.tone)}>
        <verdict.icon className="size-5 shrink-0" />
        <p className="font-heading text-base font-semibold">{verdict.title}</p>
      </div>

      <ul className="space-y-1.5 border-b px-4 py-3 text-sm empty:hidden">
        {report.pdf && <Check ok={report.pdf === "valid"}>PDF/A-3</Check>}
        {report.xml && <Check ok={report.xml === "valid"}>Rechnungsdaten</Check>}
        {profile && (
          <Check ok={profile.en16931}>
            Profil {profile.name}
            {!profile.en16931 && <span className="text-muted-foreground">erfüllt EN 16931 nicht</span>}
          </Check>
        )}
      </ul>

      {(["error", "warning", "notice"] as const).map((severity) => {
        const findings = report.findings.filter((f) => f.severity === severity);
        if (!findings.length) return null;
        const { title, icon: Icon, color } = SEVERITY[severity];
        return (
          <details key={severity} open={severity !== "notice"} className="group border-b">
            <summary className="flex cursor-pointer list-none items-center gap-2 bg-muted/40 px-4 py-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
              <Icon className={cn("size-4", color)} />
              {title}
              <span className="text-muted-foreground tabular-nums">{count(severity)}</span>
              <span className="ml-auto text-xs font-normal text-muted-foreground group-open:hidden">anzeigen</span>
            </summary>
            <ul>
              {findings.map((finding, i) => (
                <FindingRow key={i} finding={finding} onLocate={locate(finding)} />
              ))}
            </ul>
          </details>
        );
      })}

      <p className="px-4 py-3 text-xs text-muted-foreground">Geprüft mit {report.validator}</p>
    </div>
  );
}
