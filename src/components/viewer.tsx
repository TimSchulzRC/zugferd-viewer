"use client";

import { CircleCheck, CircleX, Download, FileText, FolderOpen, LoaderCircle, TriangleAlert } from "lucide-react";
import { parseAsBoolean, parseAsStringLiteral, useQueryStates } from "nuqs";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ValidationPanel, type Validation } from "@/components/validation-panel";
import { XmlPretty } from "@/components/xml-pretty";
import { XmlRaw } from "@/components/xml-raw";
import { findElement } from "@/lib/cii";
import { openFile, type OpenedFile } from "@/lib/open-file";
import { describeProfile, reportSchema, type Finding } from "@/lib/report";
import { parseLocation } from "@/lib/terms";
import { cn } from "@/lib/utils";
import { formatXml } from "@/lib/xml-format";

const PANELS = ["pdf", "xml", "check"] as const;
type PanelId = (typeof PANELS)[number];
const VIEWS = ["aufbereitet", "roh"] as const;

async function validate(file: File): Promise<Validation> {
  try {
    const body = new FormData();
    body.set("file", file);
    const response = await fetch("/api/validate", { method: "POST", body });
    const json = await response.json();
    if (!response.ok) return { state: "failed", message: json.error ?? "Prüfung fehlgeschlagen" };
    return { state: "done", report: reportSchema.parse(json) };
  } catch {
    return { state: "failed", message: "Prüfung fehlgeschlagen" };
  }
}

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

export function Viewer() {
  const [opened, setOpened] = useState<OpenedFile | null>(null);
  const [validation, setValidation] = useState<Validation>({ state: "loading" });
  const [focus, setFocus] = useState<{ line: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const run = useRef(0);

  const [query, setQuery] = useQueryStates({
    pdf: parseAsBoolean.withDefault(true),
    xml: parseAsBoolean.withDefault(true),
    check: parseAsBoolean.withDefault(true),
    view: parseAsStringLiteral(VIEWS).withDefault("aufbereitet"),
  });

  const check = useCallback(async (file: File) => {
    const id = ++run.current;
    setValidation({ state: "loading" });
    const result = await validate(file);
    if (id === run.current) setValidation(result);
  }, []);

  const open = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      try {
        const next = await openFile(file);
        setOpened((previous) => {
          if (previous?.pdfUrl) URL.revokeObjectURL(previous.pdfUrl);
          return next;
        });
        setFocus(null);
        check(file);
      } catch {
        toast.error(`${file.name} lässt sich nicht öffnen`);
      }
    },
    [check],
  );

  useEffect(() => {
    const over = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes("Files")) return;
      event.preventDefault();
      setDragging(true);
    };
    const leave = (event: DragEvent) => {
      if (!event.relatedTarget) setDragging(false);
    };
    const drop = (event: DragEvent) => {
      event.preventDefault();
      setDragging(false);
      open(event.dataTransfer?.files[0]);
    };
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [open]);

  const formatted = useMemo(() => (opened?.doc ? formatXml(opened.doc) : null), [opened]);
  const report = validation.state === "done" ? validation.report : null;

  const lineOf = useCallback(
    (finding: Finding) => {
      if (!finding.location || !opened?.doc || !formatted) return undefined;
      const element = findElement(opened.doc, parseLocation(finding.location));
      return element ? formatted.lineOf.get(element) : undefined;
    },
    [opened, formatted],
  );

  const errorLines = useMemo(() => {
    const lines = new Set<number>();
    for (const finding of report?.findings ?? []) {
      if (finding.severity !== "error") continue;
      const line = lineOf(finding);
      if (line !== undefined) lines.add(line);
    }
    return lines;
  }, [report, lineOf]);

  const picker = (
    <input ref={input} type="file" accept=".pdf,.xml,application/pdf,text/xml,application/xml" className="hidden" onChange={(event) => {
      open(event.target.files?.[0]);
      event.target.value = "";
    }} />
  );

  const dropOverlay = dragging && (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <p className="rounded-xl border-2 border-dashed border-foreground/40 px-10 py-8 font-heading text-lg font-medium">Datei hier ablegen</p>
    </div>
  );

  if (!opened) {
    return (
      <main className="flex flex-1 items-center justify-center p-6">
        {picker}
        {dropOverlay}
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="flex w-full max-w-md flex-col items-center gap-4 rounded-2xl border-2 border-dashed px-8 py-14 text-center transition-colors hover:border-foreground/40 hover:bg-muted/40 focus-visible:border-ring focus-visible:outline-none"
        >
          <FileText className="size-10 text-muted-foreground" strokeWidth={1.5} />
          <span className="font-heading text-xl font-semibold">ZUGFeRD-Rechnung öffnen</span>
          <span className="text-sm text-muted-foreground">PDF oder XML hierher ziehen oder klicken</span>
        </button>
      </main>
    );
  }

  const available: Record<PanelId, boolean> = { pdf: !!opened.pdfUrl, xml: true, check: true };
  const visible = PANELS.filter((id) => available[id] && query[id]);
  const toggle = (id: PanelId) => {
    // Hiding the last panel would leave an empty window.
    if (query[id] && visible.length === 1) return;
    setQuery({ [id]: !query[id] });
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
    const line = lineOf(finding);
    if (line === undefined) return undefined;
    return () => {
      setQuery({ xml: true, view: "roh" });
      setFocus({ line });
    };
  };

  const downloadXml = () => {
    if (!opened.xml) return;
    const url = URL.createObjectURL(new Blob([opened.xml], { type: "application/xml" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = opened.file.name.replace(/\.[^.]+$/, "") + ".xml";
    link.click();
    URL.revokeObjectURL(url);
  };

  const panels: Record<PanelId, React.ReactNode> = {
    pdf: opened.pdfUrl && <iframe src={`${opened.pdfUrl}#navpanes=0&view=FitH`} title="PDF" className="h-full w-full border-0" />,
    xml: (
      <div className="flex h-full flex-col">
        <PanelHeader title="XML">
          {opened.xml && (
            <div className="flex items-center gap-2">
              <Tabs value={query.view} onValueChange={(view) => setQuery({ view })}>
                <TabsList className="h-7">
                  <TabsTrigger value="aufbereitet">Aufbereitet</TabsTrigger>
                  <TabsTrigger value="roh">Roh</TabsTrigger>
                </TabsList>
              </Tabs>
              <Button variant="ghost" size="sm" onClick={downloadXml}>
                <Download /> Speichern
              </Button>
            </div>
          )}
        </PanelHeader>
        <div className="min-h-0 flex-1">
          {!opened.xml ? (
            <Empty>Diese PDF enthält keine Rechnungsdaten.</Empty>
          ) : query.view === "roh" ? (
            <XmlRaw formatted={formatted} source={opened.xml} errorLines={errorLines} focus={focus} />
          ) : opened.doc ? (
            <XmlPretty doc={opened.doc} />
          ) : (
            <Empty>Das XML ist nicht wohlgeformt.</Empty>
          )}
        </div>
      </div>
    ),
    check: (
      <div className="flex h-full flex-col">
        <PanelHeader title="Prüfung" />
        <div className="min-h-0 flex-1">
          <ValidationPanel validation={validation} onRetry={() => check(opened.file)} locate={locate} />
        </div>
      </div>
    ),
  };

  return (
    <main className="flex h-dvh flex-col">
      {picker}
      {dropOverlay}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b px-3">
        <p className="min-w-0 flex-1 truncate text-sm font-medium">{opened.file.name}</p>
        <div className="flex items-center gap-0.5 rounded-lg bg-muted p-[3px]" role="group" aria-label="Bereiche">
          {PANELS.filter((id) => available[id]).map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={query[id]}
              onClick={() => toggle(id)}
              className={cn(
                "flex h-7 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                query[id] ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {labels[id]}
            </button>
          ))}
        </div>
        <div className="flex flex-1 justify-end">
          <Button variant="outline" size="sm" onClick={() => input.current?.click()}>
            <FolderOpen /> Andere Datei
          </Button>
        </div>
      </header>
      <ResizablePanelGroup key={visible.join("-")} orientation="horizontal" className="min-h-0 flex-1">
        {visible.map((id, index) => (
          <Fragment key={id}>
            {index > 0 && <ResizableHandle withHandle />}
            <ResizablePanel id={id} minSize={240} defaultSize={id === "check" && visible.length > 1 ? "26" : undefined}>
              {panels[id]}
            </ResizablePanel>
          </Fragment>
        ))}
      </ResizablePanelGroup>
    </main>
  );
}
