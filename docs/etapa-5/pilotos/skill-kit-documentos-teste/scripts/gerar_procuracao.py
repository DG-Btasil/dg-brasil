"""Procuração FICTÍCIA de teste (Etapa 5). Roda no ambiente isolado do provedor.

Uso: python scripts/gerar_procuracao.py dados.json saida.pdf
Saída 2 = falta campo obrigatório.
"""
import json
import sys

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm
from reportlab.pdfgen import canvas

OBRIGATORIOS = ("nome", "cpf", "cidade")


def main() -> int:
    if len(sys.argv) != 3:
        print("uso: gerar_procuracao.py dados.json saida.pdf")
        return 1
    with open(sys.argv[1], encoding="utf-8") as f:
        dados = json.load(f)
    faltando = [c for c in OBRIGATORIOS if not str(dados.get(c, "")).strip()]
    if faltando:
        print("faltam campos: " + ", ".join(faltando))
        return 2

    c = canvas.Canvas(sys.argv[2], pagesize=A4)
    largura, altura = A4
    y = altura - 3 * cm
    c.setFont("Helvetica-Bold", 14)
    c.drawCentredString(largura / 2, y, "PROCURAÇÃO (DOCUMENTO FICTÍCIO DE TESTE)")
    y -= 1.5 * cm
    c.setFont("Helvetica", 11)
    texto = (
        f"OUTORGANTE: {dados['nome']}, CPF {dados['cpf']}, residente em {dados['cidade']}. "
        "OUTORGADA: Escritório de Teste (fictício). PODERES: os da cláusula ad judicia "
        "para ação revisional de consignado do INSS. Este documento é FICTÍCIO e foi "
        "gerado apenas para validar o DG Brasil."
    )
    linha = ""
    for palavra in texto.split():
        if c.stringWidth(linha + " " + palavra, "Helvetica", 11) > largura - 5 * cm:
            c.drawString(2.5 * cm, y, linha)
            y -= 0.6 * cm
            linha = palavra
        else:
            linha = (linha + " " + palavra).strip()
    c.drawString(2.5 * cm, y, linha)
    y -= 2 * cm
    c.drawString(2.5 * cm, y, f"{dados['cidade']}, {dados.get('data', '')}")
    y -= 2 * cm
    c.drawString(2.5 * cm, y, "______________________________________")
    y -= 0.6 * cm
    c.drawString(2.5 * cm, y, dados["nome"])
    c.showPage()
    c.save()
    print("PDF gerado: " + sys.argv[2])
    return 0


if __name__ == "__main__":
    sys.exit(main())
