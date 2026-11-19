"use client";

import { ChevronRight } from "lucide-react";
import { type Idoc, type IdocField, type IdocFile, type IdocSegment, valueOf } from "@/lib/idoc";
import { DATE_FIELDS, fieldLabel, qualifierOf, SEGMENT_LABELS, TIME_FIELDS } from "@/lib/idoc-terms";

const MAX_VALUE = 300;
// A list of segments with at most this many filled fields reads better as a table.
const MAX_TABLE_COLUMNS = 6;

function Code({ children }: { children: string }) {
  return <span className="font-mono text-[10px] tracking-tight text-muted-foreground/80">{children}</span>;
}

/** Dates and times as people write them. Everything else stays as SAP sent it, so it can be compared. */
function display(field: IdocField): string {
  const { name, value } = field;
  if (DATE_FIELDS.has(name) && /^\d{8}$/.test(value) && value !== "00000000") return `${value.slice(6)}.${value.slice(4, 6)}.${value.slice(0, 4)}`;
  if (TIME_FIELDS.has(name) && /^\d{6}$/.test(value)) return `${value.slice(0, 2)}:${value.slice(2, 4)}:${value.slice(4)}`;
  return value.length > MAX_VALUE ? `${value.slice(0, MAX_VALUE)}… (${value.length.toLocaleString("de-DE")} Zeichen)` : value;
}

/** The fields that hold something, plus the data no definition covers (a field without a name). */
function filled(segment: IdocSegment): IdocField[] {
  const fields = segment.fields.filter((field) => field.value);
  return segment.rest ? [...fields, segment.rest] : fields;
}

function qualifier(segment: IdocSegment) {
  const known = qualifierOf(segment.type);
  const value = known ? valueOf(segment.fields, known.field) : "";
  return known && value ? { field: known.field, value, meaning: known.values[value] } : null;
}

/** The German name and the technical one. Only the data outside the definition has no technical name. */
function Label({ type, name }: { type: string; name: string }) {
  if (!name) return <>Weitere Daten</>;
  return (
    <>
      {fieldLabel(type, name)} <Code>{name}</Code>
    </>
  );
}

function Fields({ type, fields }: { type: string; fields: IdocField[] }) {
  if (!fields.length) return null;
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 @md:grid-cols-2 @3xl:grid-cols-3">
      {fields.map((field, i) => (
        <div key={i} className="min-w-0">
          <dt className="flex items-baseline gap-1.5 text-xs text-muted-foreground">
            <Label type={type} name={field.name} />
          </dt>
          <dd className="text-sm break-words whitespace-pre-line">{display(field)}</dd>
        </div>
      ))}
    </dl>
  );
}

function QualifierText({ segment }: { segment: IdocSegment }) {
  const found = qualifier(segment);
  if (!found) return null;
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="font-mono text-xs text-amber-700 dark:text-amber-400">{found.value}</span>
      {found.meaning}
    </span>
  );
}

/** Segments of one type that hold little each: one row per segment, one column per field in use. */
function Table({ segments }: { segments: IdocSegment[] }) {
  const { type } = segments[0];
  const key = qualifierOf(type)?.field;
  const used = new Set(segments.flatMap((segment) => filled(segment).map((field) => field.name)));
  const columns = [...used].filter((name) => name !== key);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            {key && used.has(key) && (
              <th className="py-1.5 pr-3 font-normal whitespace-nowrap">
                <Label type={type} name={key} />
              </th>
            )}
            {columns.map((name) => (
              <th key={name} className="py-1.5 pr-3 font-normal whitespace-nowrap last:pr-0">
                <Label type={type} name={name} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {segments.map((segment, i) => (
            <tr key={i} className="border-b align-top last:border-0">
              {key && used.has(key) && (
                <td className="py-1.5 pr-3 whitespace-nowrap">
                  <QualifierText segment={segment} />
                </td>
              )}
              {columns.map((name) => {
                const field = filled(segment).find((f) => f.name === name);
                return (
                  <td key={name} className="py-1.5 pr-3 break-words last:pr-0">
                    {field && display(field)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Consecutive segments of the same type belong together: all partners, all references. */
function byType(segments: IdocSegment[]): IdocSegment[][] {
  const groups = new Map<string, IdocSegment[]>();
  for (const segment of segments) groups.set(segment.type, [...(groups.get(segment.type) ?? []), segment]);
  return [...groups.values()];
}

function Children({ segment }: { segment: IdocSegment }) {
  if (!segment.children.length) return null;
  return (
    <div className="space-y-4">
      {byType(segment.children).map((group) => (
        <div key={group[0].type} className="space-y-2">
          <h4 className="flex items-baseline gap-1.5 text-xs font-medium tracking-wide uppercase">
            {SEGMENT_LABELS[group[0].type]} <Code>{group[0].type}</Code>
          </h4>
          <Segments segments={group} />
        </div>
      ))}
    </div>
  );
}

function Body({ segment }: { segment: IdocSegment }) {
  const key = qualifier(segment)?.field;
  return (
    <div className="space-y-4">
      <Fields type={segment.type} fields={filled(segment).filter((field) => field.name !== key)} />
      <Children segment={segment} />
    </div>
  );
}

/** What stands for an item while it is closed: its number, quantity, material and value. */
function summary(segment: IdocSegment): string[] {
  if (segment.type !== "E1EDP01") {
    return filled(segment)
      .slice(0, 4)
      .map((field) => display(field));
  }
  const material = segment.children.filter((child) => child.type === "E1EDP19");
  const own = material.find((child) => valueOf(child.fields, "QUALF") === "002") ?? material[0];
  const net = segment.children.find((child) => child.type === "E1EDP26" && valueOf(child.fields, "QUALF") === "003");
  return [
    valueOf(segment.fields, "POSEX").replace(/^0+(?=\d)/, ""),
    [valueOf(segment.fields, "MENGE"), valueOf(segment.fields, "MENEE")].filter(Boolean).join(" "),
    own ? valueOf(own.fields, "KTEXT") || valueOf(own.fields, "IDTNR") : "",
    net ? valueOf(net.fields, "BETRG") : "",
  ];
}

function Segments({ segments }: { segments: IdocSegment[] }) {
  const flat = segments.every((segment) => !segment.children.length);
  const columns = new Set(segments.flatMap((segment) => filled(segment).map((field) => field.name)));
  if (flat && segments.length > 1 && columns.size <= MAX_TABLE_COLUMNS) return <Table segments={segments} />;

  // Segments with segments below them (items, texts) fold, so a long invoice stays readable.
  if (!flat && segments.length > 1) {
    return (
      <div className="divide-y border-y">
        {segments.map((segment, i) => (
          <details key={i} className="group">
            <summary className="flex cursor-pointer list-none items-baseline gap-3 py-1.5 text-sm hover:bg-muted/50 [&::-webkit-details-marker]:hidden">
              <ChevronRight className="size-4 shrink-0 self-center text-muted-foreground transition-transform group-open:rotate-90" />
              {summary(segment).map((part, j) => (
                <span key={j} className={j === 2 ? "min-w-0 flex-1 truncate" : "whitespace-nowrap tabular-nums"}>
                  {part}
                </span>
              ))}
            </summary>
            <div className="bg-muted/30 py-3 pr-3 pl-7">
              <Body segment={segment} />
            </div>
          </details>
        ))}
      </div>
    );
  }

  return (
    <div className="divide-y [&>*:not(:first-child)]:pt-4 [&>*:not(:last-child)]:pb-4">
      {segments.map((segment, i) => (
        <div key={i} className="space-y-2">
          {qualifier(segment) && (
            <div className="text-sm font-medium">
              <QualifierText segment={segment} />
            </div>
          )}
          <Body segment={segment} />
        </div>
      ))}
    </div>
  );
}

function Section({ title, code, children }: { title?: string; code: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 border-t pt-4">
      <h3 className="flex w-fit items-baseline gap-2 font-heading text-base font-semibold">
        {title} <Code>{code}</Code>
      </h3>
      {children}
    </section>
  );
}

const DIRECTIONS: Record<string, string> = { "1": "Ausgang", "2": "Eingang" };

function partner(control: IdocField[], side: "SND" | "RCV") {
  return [valueOf(control, `${side}PRN`), valueOf(control, `${side}PRT`), valueOf(control, `${side}POR`)].filter(Boolean).join(" · ");
}

function Document({ idoc }: { idoc: Idoc }) {
  const { control } = idoc;
  const message = [valueOf(control, "MESTYP"), valueOf(control, "MESCOD"), valueOf(control, "MESFCT")].filter(Boolean).join(" / ");
  const basic = [valueOf(control, "IDOCTYP"), valueOf(control, "CIMTYP")].filter(Boolean).join(" / ");
  const created = [control.find((f) => f.name === "CREDAT"), control.find((f) => f.name === "CRETIM")].filter((f) => f?.value).map((f) => display(f!));
  const facts = [
    ["Absender", partner(control, "SND")],
    ["Empfänger", partner(control, "RCV")],
    ["Erstellt", created.join(", ")],
    ["Richtung", DIRECTIONS[valueOf(control, "DIRECT")] ?? ""],
    ["Mandant", valueOf(control, "MANDT")],
    ["Test", valueOf(control, "TEST") ? "Ja" : ""],
  ].filter(([, value]) => value);

  return (
    <div className="space-y-5">
      <header>
        <p className="text-sm text-muted-foreground">{[message, basic].filter(Boolean).join(" · ") || "IDoc"}</p>
        <h2 className="font-heading text-2xl font-semibold">IDoc {valueOf(control, "DOCNUM").replace(/^0+(?=\d)/, "") || "ohne Nummer"}</h2>
      </header>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 @md:grid-cols-2 @3xl:grid-cols-3">
        {facts.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="text-sm break-words">{value}</dd>
          </div>
        ))}
      </dl>

      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-1 text-sm text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
          <ChevronRight className="size-4 transition-transform group-open:rotate-90" /> Ganzer Kontrollsatz
        </summary>
        <div className="pt-3 pl-5">
          <Fields type="EDI_DC40" fields={control.filter((field) => field.value)} />
        </div>
      </details>

      {byType(idoc.segments).map((group) => (
        <Section key={group[0].type} title={SEGMENT_LABELS[group[0].type]} code={group[0].type}>
          <Segments segments={group} />
        </Section>
      ))}
    </div>
  );
}

export function IdocPretty({ file }: { file: IdocFile }) {
  return (
    <div className="@container h-full overflow-auto">
      <div className="mx-auto max-w-4xl space-y-10 p-5">
        {file.idocs.map((idoc, i) => (
          <Document key={i} idoc={idoc} />
        ))}
      </div>
    </div>
  );
}
