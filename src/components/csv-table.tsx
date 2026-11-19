"use client";

import { useMemo } from "react";
import { parseCsv } from "@/lib/csv";
import { cn } from "@/lib/utils";

/** A table row is far heavier than a line of text, so the table stops earlier than the raw view. */
const MAX_ROWS = 5_000;
const DELIMITERS: Record<string, string> = { ";": "Semikolon", ",": "Komma", "\t": "Tabulator", "|": "senkrechter Strich" };

export function CsvTable({ text }: { text: string }) {
  const csv = useMemo(() => parseCsv(text, MAX_ROWS), [text]);
  const columns = Array.from({ length: csv.width }, (_, index) => index);
  const rows = csv.rows.length.toLocaleString("de-DE");

  return (
    <div className="h-full overflow-auto">
      <table className="border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th className="sticky top-0 left-0 z-20 border-r border-b bg-muted px-2 py-1.5" />
            {columns.map((column) => (
              <th key={column} className={cn("sticky top-0 z-10 border-r border-b bg-muted px-3 py-1.5 text-left font-medium whitespace-nowrap", csv.numeric[column] && "text-right")}>
                {csv.header?.[column] ?? <span className="font-normal text-muted-foreground">Spalte {column + 1}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {csv.rows.map((cells, index) => (
            <tr key={index} className="hover:bg-muted/50">
              <td className="sticky left-0 border-r border-b bg-background px-2 py-1 text-right font-mono text-xs text-muted-foreground/70 select-none">{index + 1}</td>
              {columns.map((column) => (
                <td key={column} className={cn("max-w-96 border-r border-b px-3 py-1 align-top break-words whitespace-pre-wrap", csv.numeric[column] && "text-right whitespace-nowrap tabular-nums")}>
                  {cells[column]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="sticky left-0 px-3 py-3 text-xs text-muted-foreground">
        {csv.truncated ? `Die ersten ${rows} Zeilen` : `${rows} ${csv.rows.length === 1 ? "Zeile" : "Zeilen"}`}, {csv.width} {csv.width === 1 ? "Spalte" : "Spalten"}, getrennt durch{" "}
        {DELIMITERS[csv.delimiter]}.{csv.truncated && " Die ganze Datei gibt es als Download."}
      </p>
    </div>
  );
}
