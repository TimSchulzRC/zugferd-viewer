"use client";

import { ChevronRight } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { buildInvoice, type Field, type Group } from "@/lib/cii";
import { cn } from "@/lib/utils";

/** Top-level groups in the order an invoice is usually read. */
const SECTION_ORDER = ["BG-4", "BG-7", "BG-10", "BG-11", "BG-13", "BG-14", "BG-25", "BG-20", "BG-21", "BG-23", "BG-22", "payment", "BG-1", "BG-3", "BG-24", "BG-2"];
// EN 16931 keeps these at invoice level, but they belong with the payment details when reading.
const PAYMENT_TERMS = new Set(["BT-9", "BT-20", "BT-81", "BT-82", "BT-83"]);
const PAYMENT_GROUPS = new Set(["BG-16", "BG-17", "BG-18", "BG-19"]);
const PLURAL: Record<string, string> = {
  "BG-1": "Bemerkungen",
  "BG-3": "Vorausgegangene Rechnungen",
  "BG-20": "Nachlässe",
  "BG-21": "Zuschläge",
  "BG-24": "Rechnungsbegründende Unterlagen",
  "BG-25": "Positionen",
};

function Code({ children }: { children: string }) {
  return <span className="font-mono text-[10px] tracking-tight text-muted-foreground/80">{children}</span>;
}

function FieldView({ field }: { field: Field }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-baseline gap-1.5 text-xs text-muted-foreground">
        {field.label}
        {field.term && <Code>{field.term.id}</Code>}
      </dt>
      <dd className="text-sm break-words whitespace-pre-line">{field.value}</dd>
    </div>
  );
}

function Fields({ fields }: { fields: Field[] }) {
  if (!fields.length) return null;
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 @md:grid-cols-2 @3xl:grid-cols-3">
      {fields.map((field, i) => (
        <FieldView key={i} field={field} />
      ))}
    </dl>
  );
}

function GroupBody({ group }: { group: Group }) {
  return (
    <div className="space-y-4">
      <Fields fields={group.fields} />
      {group.groups.map((child) => (
        <div key={child.key} className="space-y-2">
          <h4 className="flex items-baseline gap-1.5 text-xs font-medium tracking-wide uppercase">
            {child.label} <Code>{child.id}</Code>
          </h4>
          <GroupBody group={child} />
        </div>
      ))}
    </div>
  );
}

function Section({ title, code, children }: { title: string; code?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 border-t pt-4">
      <h3 className="flex items-baseline gap-2 font-heading text-base font-semibold">
        {title} {code && <Code>{code}</Code>}
      </h3>
      {children}
    </section>
  );
}

function value(group: Group, id: string): string {
  const own = group.fields.find((f) => f.term?.id === id);
  if (own) return own.value;
  for (const child of group.groups) {
    const nested = value(child, id);
    if (nested) return nested;
  }
  return "";
}

const LINE_COLUMNS = [
  { id: "BT-126", label: "Pos." },
  { id: "BT-153", label: "Bezeichnung" },
  { id: "BT-129", label: "Menge", numeric: true },
  { id: "BT-146", label: "Einzelpreis", numeric: true },
  { id: "BT-152", label: "USt", numeric: true },
  { id: "BT-131", label: "Netto", numeric: true },
];

const VAT_COLUMNS = [
  { id: "BT-118", label: "Kategorie" },
  { id: "BT-119", label: "Satz", numeric: true },
  { id: "BT-116", label: "Netto", numeric: true },
  { id: "BT-117", label: "Steuer", numeric: true },
];

type Column = { id: string; label: string; numeric?: boolean };

function Table({ columns, rows, expandable }: { columns: Column[]; rows: Group[]; expandable?: boolean }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            {expandable && <th className="w-6" />}
            {columns.map((column) => (
              <th key={column.id} className={cn("py-1.5 pr-3 font-normal whitespace-nowrap last:pr-0", column.numeric && "text-right")}>
                {column.label} <Code>{column.id}</Code>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <Fragment key={row.key}>
              <tr
                className={cn("border-b align-top last:border-0", expandable && "cursor-pointer hover:bg-muted/50")}
                onClick={expandable ? () => toggle(row.key) : undefined}
              >
                {expandable && (
                  <td className="py-1.5">
                    <button type="button" aria-expanded={open.has(row.key)} aria-label="Alle Angaben der Position" className="flex size-5 items-center justify-center rounded text-muted-foreground">
                      <ChevronRight className={cn("size-4 transition-transform", open.has(row.key) && "rotate-90")} />
                    </button>
                  </td>
                )}
                {columns.map((column) => (
                  <td key={column.id} className={cn("py-1.5 pr-3 last:pr-0", column.numeric && "text-right whitespace-nowrap tabular-nums")}>
                    {value(row, column.id)}
                  </td>
                ))}
              </tr>
              {expandable && open.has(row.key) && (
                <tr className="border-b bg-muted/30">
                  <td />
                  <td colSpan={columns.length} className="py-3 pr-3">
                    <GroupBody group={row} />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Totals({ group }: { group: Group }) {
  return (
    <dl className="ml-auto max-w-sm space-y-1 text-sm">
      {group.fields.map((field, i) => (
        <div key={i} className={cn("flex items-baseline justify-between gap-4", field.term?.id === "BT-115" && "border-t pt-1 text-base font-semibold")}>
          <dt className="flex items-baseline gap-1.5">
            {field.label} {field.term && <Code>{field.term.id}</Code>}
          </dt>
          <dd className="whitespace-nowrap tabular-nums">{field.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function XmlPretty({ doc }: { doc: Document }) {
  const invoice = useMemo(() => buildInvoice(doc), [doc]);
  const { root } = invoice;

  const header = root.fields.filter((f) => !f.term || !PAYMENT_TERMS.has(f.term.id));
  const payment: Group = {
    key: "payment",
    id: "payment",
    label: "Zahlung",
    fields: root.fields.filter((f) => f.term && PAYMENT_TERMS.has(f.term.id)),
    groups: root.groups.filter((g) => PAYMENT_GROUPS.has(g.id)),
  };

  const sections = new Map<string, Group[]>();
  for (const group of root.groups) {
    if (PAYMENT_GROUPS.has(group.id)) continue;
    sections.set(group.id, [...(sections.get(group.id) ?? []), group]);
  }
  if (payment.fields.length || payment.groups.length) sections.set("payment", [payment]);
  const ordered = [...SECTION_ORDER.filter((id) => sections.has(id)), ...[...sections.keys()].filter((id) => !SECTION_ORDER.includes(id))];

  const type = value(root, "BT-3").replace(/ \(\d+\)$/, "") || "Rechnung";

  return (
    <div className="@container h-full overflow-auto">
      <div className="mx-auto max-w-4xl space-y-5 p-5">
        <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div>
            <p className="text-sm text-muted-foreground">{type}</p>
            <h2 className="font-heading text-2xl font-semibold">{value(root, "BT-1") || "Ohne Nummer"}</h2>
          </div>
          <p className="text-2xl font-semibold tabular-nums">{value(root, "BT-115")}</p>
        </header>

        <Fields fields={header} />

        {ordered.map((id) => {
          const groups = sections.get(id)!;
          const title = groups.length > 1 || id === "BG-25" ? (PLURAL[id] ?? groups[0].label) : groups[0].label;
          const code = id.startsWith("BG-") ? id : undefined;
          return (
            <Section key={id} title={title} code={code}>
              {id === "BG-25" ? (
                <Table columns={LINE_COLUMNS} rows={groups} expandable />
              ) : id === "BG-23" ? (
                <Table columns={VAT_COLUMNS} rows={groups} />
              ) : id === "BG-22" ? (
                <Totals group={groups[0]} />
              ) : (
                <div className="divide-y [&>*:not(:first-child)]:pt-4 [&>*:not(:last-child)]:pb-4">
                  {groups.map((group) => (
                    <GroupBody key={group.key} group={group} />
                  ))}
                </div>
              )}
            </Section>
          );
        })}

        {invoice.other.length > 0 && (
          <Section title="Weitere Angaben">
            <Fields fields={invoice.other} />
          </Section>
        )}
      </div>
    </div>
  );
}
