/**
 * Erros do Supabase Auth → mensagens em português, sem detalhe técnico nem
 * diferença entre "e-mail não existe" e "senha errada".
 */
interface AuthLikeError {
  code?: string;
  status?: number;
  message?: string;
  name?: string;
}

const GENERIC = "Não foi possível concluir agora. Tente novamente em instantes.";

export function loginErrorMessage(error: AuthLikeError | null | undefined): string {
  if (!error) return GENERIC;
  if (error.status === 429 || error.code === "over_request_rate_limit") {
    return "Muitas tentativas. Aguarde alguns minutos antes de tentar de novo.";
  }
  if (error.name === "AuthRetryableFetchError" || error.status === 0) {
    return "Não foi possível conectar ao servidor. Verifique sua conexão.";
  }
  // invalid_credentials, user_not_found, email_not_confirmed, user_banned...:
  // a mesma resposta, para não revelar se o e-mail existe.
  return "E-mail ou senha incorretos.";
}

export function mfaErrorMessage(error: AuthLikeError | null | undefined): string {
  if (!error) return GENERIC;
  if (error.status === 429 || error.code === "over_request_rate_limit" || error.code === "too_many_enrolled_mfa_factors") {
    return "Muitas tentativas. Aguarde alguns minutos.";
  }
  if (error.code === "mfa_verification_failed" || error.code === "mfa_challenge_expired" || error.status === 422 || error.status === 400) {
    return "Código inválido ou expirado. Confira o horário do celular e tente o código atual.";
  }
  return GENERIC;
}

export function passwordErrorMessage(error: AuthLikeError | null | undefined): string {
  if (!error) return GENERIC;
  if (error.code === "weak_password") return "A senha não atende à política de segurança. Escolha outra mais forte.";
  if (error.code === "same_password") return "A nova senha precisa ser diferente da anterior.";
  if (error.code === "insufficient_aal") return "Confirme o código de verificação em duas etapas antes de trocar a senha.";
  if (error.code === "reauthentication_needed") {
    return "Por segurança, saia e entre novamente (ou use “Esqueci minha senha”) antes de trocar a senha.";
  }
  if (error.status === 429 || error.code === "over_request_rate_limit") return "Muitas tentativas. Aguarde alguns minutos.";
  return GENERIC;
}

/**
 * Remove o que nunca pode ir para log: tokens, segredos, senhas, códigos.
 * Para logs técnicos do servidor.
 */
export function sanitizeForLog(error: unknown): { code?: string; status?: number; message: string } {
  const e = (error ?? {}) as AuthLikeError;
  const message = String(e.message ?? error ?? "")
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[jwt]")
    // token, token_hash, access_token, refresh_token, ref (convite), code, key, secret, senha...
    .replace(/([\w-]*(?:token|secret|password|senha|code|codigo|key|ref)[\w-]*)=([^&\s"]+)/gi, "$1=[oculto]")
    .replace(/"([\w-]*(?:token|secret|password|key)[\w-]*)"\s*:\s*"[^"]*"/gi, '"$1":"[oculto]"')
    .slice(0, 300);
  return { code: e.code, status: e.status, message };
}
