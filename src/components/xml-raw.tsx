"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import type { FormattedXml, TokenKind } from "@/lib/xml-format";

// Element names carry the structure, so they get the strongest colour. Brackets and namespace
// prefixes repeat on every line and stay quiet. Values are dark so the actual data stands out.
const COLORS: Record<TokenKind, string> = {
  bracket: "text-slate-400 dark:text-slate-500",
  prefix: "text-slate-400 dark:text-slate-500",
  name: "text-blue-700 dark:text-blue-400",
  attr: "text-amber-700 dark:text-amber-400",
  equals: "text-slate-400 dark:text-slate-500",
  quote: "text-emerald-700/50 dark:text-emerald-400/50",
  value: "text-emerald-700 dark:text-emerald-400",
  text: "font-medium text-foreground",
  number: "font-medium text-fuchsia-700 dark:text-fuchsia-400",
  comment: "text-slate-400 italic dark:text-slate-500",
  prolog: "text-slate-400 dark:text-slate-500",
};

const INDENT = 2;
const GUIDES = "repeating-linear-gradient(to right, var(--border) 0 1px, transparent 1px 2ch)";

type Props = {
  formatted: FormattedXml | null;
  /** Shown as plain text when the XML could not be parsed. */
  source: string;
  errorLines: Set<number>;
  focus: { line: number } | null;
};

export function XmlRaw({ formatted, source, errorLines, focus }: Props) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!focus) return;
    container.current?.querySelector(`[data-line="${focus.line}"]`)?.scrollIntoView({ block: "center" });
  }, [focus]);

  if (!formatted) return <pre className="h-full overflow-auto p-4 font-mono text-xs">{source}</pre>;

  const digits = String(formatted.lines.length).length;
  return (
    <div ref={container} className="h-full overflow-auto py-2 font-mono text-xs leading-5 [font-variant-ligatures:none]">
      <div className="w-max min-w-full">
        {formatted.lines.map((line, index) => (
          <div
            key={index}
            data-line={index}
            className={cn("flex pr-4 [contain-intrinsic-size:auto_1.25rem] [content-visibility:auto]", errorLines.has(index) && "bg-red-500/10", focus?.line === index && "bg-amber-400/25")}
          >
            <span
              className={cn("sticky left-0 shrink-0 bg-background pr-3 pl-3 text-right text-muted-foreground/70 select-none", errorLines.has(index) && "text-red-600")}
              style={{ width: `${digits + 3}ch` }}
            >
              {index + 1}
            </span>
            <span
              className="bg-no-repeat whitespace-pre"
              style={{ paddingLeft: `${line.indent * INDENT}ch`, backgroundImage: GUIDES, backgroundSize: `${line.indent * INDENT}ch 100%` }}
            >
              {line.tokens.map((token, i) => (
                <span key={i} className={COLORS[token.kind]}>
                  {token.text}
                </span>
              ))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
