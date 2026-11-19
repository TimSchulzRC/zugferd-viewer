/** CSV as a table: which character separates the cells, where the header is, which columns hold numbers. */

export type Csv = {
  delimiter: string;
  /** The first row, when it names the columns. Otherwise the columns are numbered. */
  header: string[] | null;
  rows: string[][];
  /** How many cells the widest row has. */
  width: number;
  /** Per column: every cell that holds something is a number. */
  numeric: boolean[];
};

/** German and English notation, and SAP's minus sign at the end. A leading zero makes it a code, not a number. */
const NUMBER = /^-?(?!0\d)\d+(?:[.,' ]\d{3})*(?:[.,]\d+)?-?$/;

// In this order: a file of German decimals ("1,23;4,56") has as steady a count of commas as of semicolons.
const DELIMITERS = [";", "\t", "|", ","];
const HEAD = 8192;
/** Windows, Unix and old Mac line ends. */
export const LINE_BREAK = /\r\n?|\n/;

/** The first lines without their quoted cells, which may hold the delimiter. */
function firstLines(text: string): string[] {
  const lines = text.slice(0, HEAD).replace(/^\uFEFF/, "").split(LINE_BREAK);
  // The cut may have gone through a line. A first line longer than the sample still shows its delimiter.
  if (text.length > HEAD && lines.length > 1) lines.pop();
  // The second pattern drops a quoted cell the sample ends in.
  return lines.filter(Boolean).slice(0, 5).map((line) => line.replace(/"(?:[^"]|"")*"/g, "").replace(/"[^"]*$/, ""));
}

/** The delimiter that cuts each of the first lines into the same number of cells. */
function steady(lines: string[], least: (delimiter: string) => number): string | null {
  return (
    DELIMITERS.find((delimiter) => {
      const counts = lines.map((line) => line.split(delimiter).length - 1);
      return counts.length > 0 && counts[0] >= least(delimiter) && counts.every((count) => count === counts[0]);
    }) ?? null
  );
}

/** Whether text without a telling name is CSV. A comma also appears in prose, so it has to show up more often. */
export function looksLikeCsv(text: string): boolean {
  const lines = firstLines(text);
  return lines.length > 1 && steady(lines, (delimiter) => (delimiter === "," ? 2 : 1)) !== null;
}

/** The steady delimiter, else the one that splits the first line into the most cells. */
export function csvDelimiter(text: string): string {
  const lines = firstLines(text);
  const first = lines[0] ?? "";
  return steady(lines, () => 1) ?? DELIMITERS.map((delimiter) => ({ delimiter, cells: first.split(delimiter).length })).sort((a, b) => b.cells - a.cells)[0].delimiter;
}

/** Reads at most maxRows rows. A quoted cell may hold the delimiter, line breaks and doubled quotes. */
export function parseCsv(text: string, maxRows: number): Csv & { truncated: boolean } {
  const delimiter = csvDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let truncated = false;
  const endRow = () => {
    row.push(cell);
    cell = "";
    // A line break at the end of the file starts no row.
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
  };

  for (let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch !== '"') cell += ch;
      else if (text[i + 1] === '"') cell += text[i++];
      else quoted = false;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endRow();
      if (rows.length > maxRows) {
        truncated = true;
        break;
      }
    } else cell += ch;
  }
  if (!truncated && (cell || row.length)) endRow();
  if (rows.length > maxRows) rows.length = maxRows;

  const width = Math.max(0, ...rows.map((cells) => cells.length));
  const [first] = rows;
  const isHeader = rows.length > 1 && first.length === width && first.every((name) => name.trim() && !NUMBER.test(name.trim())) && new Set(first).size === width;
  const body = isHeader ? rows.slice(1) : rows;
  const numeric = Array.from({ length: width }, (_, column) => {
    const values = body.map((cells) => cells[column]?.trim()).filter(Boolean) as string[];
    return values.length > 0 && values.every((value) => NUMBER.test(value));
  });
  return { delimiter, header: isHeader ? first : null, rows: body, width, numeric, truncated };
}
