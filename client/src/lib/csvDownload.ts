import { csvFileName, toCsv, type CsvColumn } from "@shared/csv";

// O BOM faz o Excel abrir o arquivo como UTF-8 (acentos corretos).
export function downloadCsv<T>(prefix: string, rows: T[], columns: Array<CsvColumn<T>>) {
  const blob = new Blob(["﻿", toCsv(rows, columns)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = csvFileName(prefix);
  link.click();
  URL.revokeObjectURL(url);
}
