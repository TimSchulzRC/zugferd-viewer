"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CircleCheck, CircleX, Download, LoaderCircle, TriangleAlert } from "lucide-react";
import { parseAsBoolean, parseAsString, parseAsStringLiteral, useQueryStates } from "nuqs";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UserMenu } from "@/components/user-menu";
import { ValidationPanel, type Validation } from "@/components/validation-panel";
import { XmlPretty } from "@/components/xml-pretty";
import { XmlRaw } from "@/components/xml-raw";
import { api, download } from "@/lib/api";
import { findElement, resolveTerm } from "@/lib/cii";
import { openFile } from "@/lib/open-file";
import { describeProfile, type Finding, offersXRechnung, reportFor, RULESETS } from "@/lib/report";
import { parseLocation } from "@/lib/terms";
import { cn } from "@/lib/utils";
import { formatXml } from "@/lib/xml-format";

const PANELS = ["pdf", "xml", "check"] as const;
type PanelId = (typeof PANELS)[number];
const VIEWS = ["aufbereitet", "roh"] as const;

type Focus = { finding: Finding; element: Element | null; line: number | undefined };

function PanelHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b px-3">
      <h2 className="text-sm font-medium">{title}</h2>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">{children}</div>;
}

export function Viewer({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const [focus, setFocus] = useState<Focus | null>(null);
  const [query, setQuery] = useQueryStates({
    pdf: parseAsBoolean.withDefault(true),
    xml: parseAsBoolean.withDefault(true),
    check: parseAsBoolean.withDefault(true),
    view: parseAsStringLiteral(VIEWS).withDefault("aufbereitet"),
    regeln: parseAsStringLiteral(RULESETS).withDefault("zugferd"),
    datei: parseAsString,
    ordner: parseAsString,
  });

  const details = useQuery({ queryKey: ["file", id], queryFn: () => api.file(id) });
  const name = details.data?.node.name;
  const opened = useQuery({
    queryKey: ["content", id],
    enabled: !!name,
    staleTime: Infinity,
    gcTime: 0,
    queryFn: async () => {
      const response = await fetch(`/api/nodes/${id}/content`);
      if (!response.ok) throw new Error("Die Datei lässt sich nicht laden");
      return openFile(new File([await response.blob()], name!));
    },
  });
  const pdfUrl = opened.data?.pdfUrl;
  useEffect(() => () => void (pdfUrl && URL.revokeObjectURL(pdfUrl)), [pdfUrl]);

  const recheck = useMutation({ mutationFn: () => api.revalidate(id), onSuccess: (data) => queryClient.setQueryData(["file", id], data) });

  const doc = opened.data?.doc ?? null;
  const formatted = useMemo(() => (doc ? formatXml(doc) : null), [doc]);
  const stored = details.data?.report ?? null;
  const choosable = offersXRechnung(stored);
  const ruleset = choosable ? query.regeln : "zugferd";
  const report = useMemo(() => (stored ? reportFor(stored, ruleset) : null), [stored, ruleset]);

  const validation: Validation = recheck.isPending
    ? { state: "loading" }
    : report
      ? { state: "done", report }
      : { state: "failed", message: recheck.error?.message ?? "Diese Datei wurde noch nicht geprüft." };

  /** Where a finding points in the XML: the element the validator named, else the first element of its terms. */
  const target = useCallback(
    (finding: Finding): { element: Element | null; line: number | undefined } | null => {
      if (!doc || !formatted) return null;
      const located = finding.location ? findElement(doc, parseLocation(finding.location)) : null;
      const byTerm = located ? null : [...doc.getElementsByTagName("*")].find((el) => finding.terms.includes(resolveTerm(el)?.id ?? ""));
      const element = located ?? byTerm ?? null;
      if (!element && !finding.terms.length) return null;
      return { element: located, line: element ? formatted.lineOf.get(element) : undefined };
    },
    [doc, formatted],
  );

  const errorLines = useMemo(() => {
    const lines = new Set<number>();
    for (const finding of report?.findings ?? []) {
      if (finding.severity !== "error") continue;
      const line = target(finding)?.line;
      if (line !== undefined) lines.add(line);
    }
    return lines;
  }, [report, target]);

  const back = () => setQuery({ datei: null, ordner: details.data?.node.parentId ?? query.ordner });

  if (details.isError || opened.isError) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-sm">
        <p>{(details.error ?? opened.error)?.message}</p>
        <Button variant="outline" size="sm" onClick={() => setQuery({ datei: null })}>
          Zurück
        </Button>
      </main>
    );
  }

  const file = opened.data;
  const available: Record<PanelId, boolean> = { pdf: !file || !!file.pdfUrl, xml: true, check: true };
  const visible = PANELS.filter((panel) => available[panel] && query[panel]);
  const shown = visible.length ? visible : (["xml"] as PanelId[]);
  const toggle = (panel: PanelId) => {
    // Hiding the last panel would leave an empty window.
    if (query[panel] && shown.length === 1) return;
    setQuery({ [panel]: !query[panel] });
  };

  const errors = report?.findings.filter((f) => f.severity === "error").length ?? 0;
  const profile = describeProfile(report?.profile ?? null);
  const StatusIcon = validation.state === "loading" ? LoaderCircle : validation.state === "failed" ? TriangleAlert : !report?.valid ? CircleX : profile?.en16931 ? CircleCheck : TriangleAlert;
  const statusColor = validation.state === "loading" ? "animate-spin text-muted-foreground" : validation.state === "failed" ? "text-muted-foreground" : !report?.valid ? "text-red-600" : profile?.en16931 ? "text-emerald-600" : "text-amber-600";

  const labels: Record<PanelId, React.ReactNode> = {
    pdf: "PDF",
    xml: "XML",
    check: (
      <>
        <StatusIcon className={cn("size-4", statusColor)} />
        Prüfung
        {errors > 0 && <span className="text-red-600 tabular-nums">{errors}</span>}
      </>
    ),
  };

  const locate = (finding: Finding) => {
    const found = target(finding);
    if (!found) return undefined;
    return () => {
      // Stays in whichever XML view is open; both mark the spot.
      setQuery({ xml: true });
      setFocus({ finding, ...found });
    };
  };

  const loading = <Empty><LoaderCircle className="size-5 animate-spin" /></Empty>;

  const panels: Record<PanelId, React.ReactNode> = {
    pdf: file?.pdfUrl ? <iframe src={`${file.pdfUrl}#navpanes=0&view=FitH`} title="PDF" className="h-full w-full border-0" /> : loading,
    xml: (
      <div className="flex h-full flex-col">
        <PanelHeader title="XML">
          {file?.xml && (
            <Tabs value={query.view} onValueChange={(view) => setQuery({ view })}>
              <TabsList className="h-7">
                <TabsTrigger value="aufbereitet">Aufbereitet</TabsTrigger>
                <TabsTrigger value="roh">Roh</TabsTrigger>
              </TabsList>
            </Tabs>
          )}
        </PanelHeader>
        <div className="min-h-0 flex-1">
          {!file ? (
            loading
          ) : !file.xml ? (
            <Empty>Diese PDF enthält keine Rechnungsdaten.</Empty>
          ) : query.view === "roh" ? (
            <XmlRaw formatted={formatted} source={file.xml} errorLines={errorLines} focus={focus?.line !== undefined ? { line: focus.line } : null} />
          ) : file.doc ? (
            <XmlPretty doc={file.doc} focus={focus} />
          ) : (
            <Empty>Das XML ist nicht wohlgeformt.</Empty>
          )}
        </div>
      </div>
    ),
    check: (
      <div className="flex h-full flex-col">
        <PanelHeader title="Prüfung">
          {choosable && (
            <Tabs value={ruleset} onValueChange={(regeln) => setQuery({ regeln })}>
              <TabsList className="h-7">
                <TabsTrigger value="zugferd">ZUGFeRD</TabsTrigger>
                <TabsTrigger value="xrechnung">XRechnung</TabsTrigger>
              </TabsList>
            </Tabs>
          )}
        </PanelHeader>
        <div className="min-h-0 flex-1">
          <ValidationPanel validation={validation} ruleset={ruleset} onRetry={() => recheck.mutate()} locate={locate} />
        </div>
      </div>
    ),
  };

  return (
    <main className="flex h-dvh flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <Button variant="ghost" size="icon" aria-label="Zurück zum Ordner" onClick={back}>
            <ArrowLeft />
          </Button>
          <p className="truncate text-sm font-medium">{name}</p>
        </div>
        <div className="flex items-center gap-0.5 rounded-lg bg-muted p-[3px]" role="group" aria-label="Bereiche">
          {PANELS.filter((panel) => available[panel]).map((panel) => (
            <button
              key={panel}
              type="button"
              aria-pressed={shown.includes(panel)}
              onClick={() => toggle(panel)}
              className={cn(
                "flex h-7 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                shown.includes(panel) ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {labels[panel]}
            </button>
          ))}
        </div>
        <div className="flex flex-1 items-center justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => download([id])}>
            <Download /> Herunterladen
          </Button>
          <UserMenu />
        </div>
      </header>
      <ResizablePanelGroup key={shown.join("-")} orientation="horizontal" className="min-h-0 flex-1">
        {shown.map((panel, index) => (
          <Fragment key={panel}>
            {index > 0 && <ResizableHandle withHandle />}
            <ResizablePanel id={panel} minSize={240} defaultSize={panel === "check" && shown.length > 1 ? "26" : undefined}>
              {panels[panel]}
            </ResizablePanel>
          </Fragment>
        ))}
      </ResizablePanelGroup>
    </main>
  );
}
