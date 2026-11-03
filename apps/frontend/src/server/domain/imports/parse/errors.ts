/** Arquivo que não dá para ler. A mensagem é para o usuário (português, sem detalhe técnico). */
export class ImportFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportFileError";
  }
}
