import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

/**
 * Cabeçalhos de segurança em todas as respostas. Não é uma CSP estrita de
 * scripts (fica para quando o app tiver nonce); aqui: sem iframe de terceiros
 * (clickjacking), sem sniffing de tipo, sem referrer para fora (links de
 * convite/recuperação levam parâmetros), sem APIs sensíveis do navegador.
 */
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // HSTS só em produção (em localhost/HTTP o navegador ignora, mas evita confusão).
  ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
];

/** Telas e callbacks de identidade: nunca em cache (nem do navegador, nem de CDN). */
const NO_STORE_PATHS = [
  "/login",
  "/recuperar-senha",
  "/nova-senha",
  "/primeiro-acesso",
  "/termos",
  "/seguranca/:path*",
  "/acesso",
  "/auth/:path*",
];

const nextConfig: NextConfig = {
  // Sem isto, o Turbopack sobe diretórios procurando lockfile e encontra um alheio.
  turbopack: { root: dirname(fileURLToPath(import.meta.url)) },
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      ...NO_STORE_PATHS.map((source) => ({ source, headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }] })),
    ];
  },
};

export default nextConfig;
