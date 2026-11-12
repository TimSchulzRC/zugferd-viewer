"use client";

import { parseAsString, useQueryState } from "nuqs";
import { FileManager } from "@/components/file-manager";
import { Viewer } from "@/components/viewer";

/** One page: the folder view, or the viewer once a file is open (?datei=…). */
export function App() {
  const [file] = useQueryState("datei", parseAsString);
  return file ? <Viewer key={file} id={file} /> : <FileManager />;
}
