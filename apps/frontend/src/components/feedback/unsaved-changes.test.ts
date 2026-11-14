import { describe, expect, it } from "vitest";
import { interceptedHref } from "./unsaved-changes";

const here = { origin: "https://dg.example", pathname: "/revisoes/1", search: "" };
const left = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };

describe("aviso ao sair com edição não salva", () => {
  it("intercepta o clique comum em link interno para outra tela", () => {
    expect(interceptedHref(left, { href: "https://dg.example/casos/2?aba=analise" }, here)).toBe("/casos/2?aba=analise");
    expect(interceptedHref(left, { href: "/revisoes" }, here)).toBe("/revisoes");
  });

  it("deixa passar nova aba, link externo, download, outra janela e âncora na mesma tela", () => {
    expect(interceptedHref({ ...left, ctrlKey: true }, { href: "/revisoes" }, here)).toBeNull();
    expect(interceptedHref({ ...left, button: 1 }, { href: "/revisoes" }, here)).toBeNull();
    expect(interceptedHref(left, { href: "https://outro.site/x" }, here)).toBeNull();
    expect(interceptedHref(left, { href: "/arquivo.pdf", download: true }, here)).toBeNull();
    expect(interceptedHref(left, { href: "/revisoes", target: "_blank" }, here)).toBeNull();
    expect(interceptedHref(left, { href: "#conteudo" }, here)).toBeNull();
    expect(interceptedHref(left, null, here)).toBeNull();
  });
});
