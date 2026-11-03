import { describe, expect, it } from "vitest";
import { csvBlob } from "./csv-blob";

describe("CSV baixado (QA 7, IMP-03)", () => {
  it("começa com o BOM UTF-8 exatamente uma vez, venha ou não do servidor", async () => {
    for (const content of ["Linha;Situação\r\n", "﻿Linha;Situação\r\n"]) {
      const bytes = new Uint8Array(await csvBlob(content).arrayBuffer());
      expect([...bytes.slice(0, 6)]).toEqual([0xef, 0xbb, 0xbf, 0x4c, 0x69, 0x6e]);
    }
  });
});
