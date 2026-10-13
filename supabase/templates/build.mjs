/**
 * DG Brasil — gerador dos e-mails do Supabase Auth (convite e recuperação).
 *
 * `invite.html` e `recovery.html` são GERADOS por este arquivo: layout e estilos
 * ficam num lugar só. Edite aqui (ou `email.config.json`) e rode o gerador.
 *
 *   node templates/build.mjs               grava invite.html e recovery.html
 *   node templates/build.mjs --check       falha se estiverem desatualizados ou inválidos (CI)
 *   node templates/build.mjs --preview D   grava pré-visualizações em D (com/sem nome, modo escuro)
 *
 * O Supabase Auth renderiza com `html/template` do Go, SEM funções extras
 * (só `if`, `else`, `eq`...). Consequências que moldam este arquivo:
 *  - comentários HTML são removidos na renderização → nada de `<!--[if mso]>`;
 *    o botão é uma tabela com `bgcolor` (funciona no Outlook sem VML);
 *  - não há como recortar o primeiro nome no template → ele vem pronto em
 *    `user_metadata.first_name` (gravado no convite), com `full_name` e "Olá!"
 *    como fallback;
 *  - não há variável de configuração → o e-mail de suporte entra aqui, na
 *    geração, e a seção só existe quando `supportEmail` está preenchido.
 *
 * Os links preservam exatamente o formato que `/auth/confirm` valida:
 * `{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=<invite|recovery>`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------------ */
/* Identidade (apps/frontend/src/app/globals.css)                      */

const C = {
  navy: "#0b1f33",
  navy600: "#33506d",
  gold: "#c9a227",
  gold300: "#e2cc84",
  gold50: "#fbf8ee",
  goldLine: "#eee2bc",
  text: "#18222d",
  muted: "#5f6b79",
  line: "#dde2e7",
  page: "#eef1f4",
  footer: "#f7f8fa",
  onNavy: "#b9c4cf",
};
const SERIF = "Georgia, 'Times New Roman', Times, serif";
const SANS = "'Helvetica Neue', Helvetica, Arial, sans-serif";

const BRAND = "DG Brasil";
const INSTITUTION = "Bárbara Cardoso Advocacia";
const TAGLINE = `Plataforma de parceiros da ${INSTITUTION}`;

/* ------------------------------------------------------------------ */
/* Configuração                                                        */

// Domínios reservados/de exemplo: nunca vão para um e-mail real.
const PLACEHOLDER_EMAIL = /@(?:[^@]+\.)?(?:example\.(?:com|net|org)|exemplo\.[a-z.]+)$|\.(?:test|exemplo|example|invalid|localhost|local)$/i;
const EMAIL_FORMAT = /^[^\s@<>"'&]+@[^\s@<>"'&]+\.[a-z]{2,}$/i;

function loadConfig() {
  const raw = JSON.parse(readFileSync(join(DIR, "email.config.json"), "utf8"));
  const supportEmail = String(raw.supportEmail ?? "").trim();
  if (supportEmail && !EMAIL_FORMAT.test(supportEmail)) fail(`supportEmail inválido: "${supportEmail}"`);
  if (supportEmail && PLACEHOLDER_EMAIL.test(supportEmail)) fail(`supportEmail é um endereço de exemplo: "${supportEmail}"`);
  return { supportEmail };
}

/* ------------------------------------------------------------------ */
/* Variáveis: Go template (produção) ou valores de exemplo (preview)  */

const GO = {
  greeting:
    "{{ if .Data.first_name }}Olá, {{ .Data.first_name }}!{{ else if .Data.full_name }}Olá, {{ .Data.full_name }}!{{ else }}Olá!{{ end }}",
  email: "{{ .Email }}",
  href: (type) => `{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=${type}`,
  linkText: (type) => `{{ .RedirectTo }}&amp;token_hash={{ .TokenHash }}&amp;type=${type}`,
  /** Conteúdo por papel do convite (`user_metadata.invite_role`); sem papel → `fallback`. */
  byRole: (branches) => {
    const cases = ROLES.map((role, i) => `{{ ${i ? "else if" : "if"} eq . "${role}" }}${branches[role]}`).join("");
    return `{{ with $.Data.invite_role }}${cases}{{ else }}${branches.fallback}{{ end }}{{ else }}${branches.fallback}{{ end }}`;
  },
  /** Nome do escritório (`user_metadata.organization_name`), com alternativa se faltar. */
  org: (withName, without) => `{{ with $.Data.organization_name }}${withName("{{ . }}")}{{ else }}${without}{{ end }}`,
};

const ROLES = ["ADMIN", "LAWYER", "ASSISTANT", "PARTNER_ADMIN", "PARTNER_USER"];

function previewVars(sample) {
  const url = (type, fluxo) =>
    `https://app.barbaracardoso.adv.br/auth/confirm?fluxo=${fluxo}${fluxo === "convite" ? "&ref=Xq3v9LwP2mZt8RkA1cYb7NdE4hJsQ0uVfGo5TiWe6Ly" : ""}&token_hash=pkce_8f2c41e09b7d4a6c9e3f1b25d7a0c8e4&type=${type}`;
  return {
    greeting: sample.firstName ? `Olá, ${esc(sample.firstName)}!` : "Olá!",
    email: esc(sample.email),
    href: (type) => esc(url(type, type === "invite" ? "convite" : "recuperacao")),
    linkText: (type) => esc(url(type, type === "invite" ? "convite" : "recuperacao")),
    byRole: (branches) => branches[sample.role] ?? branches.fallback,
    org: (withName, without) => (sample.org ? withName(esc(sample.org)) : without),
  };
}

/* ------------------------------------------------------------------ */
/* Peças                                                               */

function esc(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const text = (html, { size = 15, color = C.text, margin = "0 0 16px", cls = "dg-text", extra = "" } = {}) =>
  `<p class="${cls}" style="margin:${margin};font-family:${SANS};font-size:${size}px;line-height:1.65;color:${color};${extra}">${html}</p>`;

const muted = (html, opts = {}) => text(html, { size: 13, color: C.muted, cls: "dg-muted", ...opts });

function eyebrow(label) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td valign="middle" style="padding-right:12px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="28" height="2" bgcolor="${C.gold}" style="width:28px;height:2px;background:${C.gold};font-size:0;line-height:0;">&nbsp;</td></tr></table>
              </td>
              <td valign="middle" class="dg-eyebrow" style="font-family:${SANS};font-size:11px;font-weight:bold;line-height:1;letter-spacing:2px;text-transform:uppercase;color:${C.navy600};">${label}</td>
            </tr>
          </table>`;
}

const title = (label) =>
  `<h1 class="dg-title dg-title-main" style="margin:20px 0 24px;font-family:${SERIF};font-size:30px;font-weight:normal;line-height:1.2;color:${C.navy};">${label}</h1>`;

function button(href, label) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" class="dg-btn-wrap" style="margin:12px 0 24px;">
            <tr>
              <td class="dg-btn" align="center" bgcolor="${C.navy}" style="background:${C.navy};border-radius:6px;mso-padding-alt:16px 40px;">
                <a href="${href}" target="_blank" style="display:inline-block;padding:16px 40px;font-family:${SANS};font-size:15px;font-weight:bold;line-height:1.2;letter-spacing:0.3px;color:#ffffff;text-decoration:none;border-radius:6px;">${label}</a>
              </td>
            </tr>
          </table>`;
}

function fallbackLink(href, linkText) {
  return `${muted("Se o botão não funcionar, copie e cole este endereço no navegador:", { margin: "0 0 6px" })}
          <p class="dg-break" style="margin:0 0 8px;font-family:${SANS};font-size:12px;line-height:1.5;word-break:break-all;"><a class="dg-link" href="${href}" target="_blank" style="color:${C.navy600};text-decoration:underline;">${linkText}</a></p>`;
}

/** Painel de destaque (etapas, aviso de segurança). */
function panel(inner, { accent = false } = {}) {
  const border = accent ? `border:1px solid ${C.goldLine};border-left:3px solid ${C.gold};` : `border:1px solid ${C.goldLine};`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="dg-panel" bgcolor="${C.gold50}" style="width:100%;background:${C.gold50};${border}border-radius:8px;">
            <tr><td style="padding:22px 24px 8px;">${inner}</td></tr>
          </table>`;
}

const panelTitle = (label) =>
  `<p class="dg-title" style="margin:0 0 16px;font-family:${SERIF};font-size:17px;line-height:1.3;color:${C.navy};">${label}</p>`;

function steps(items) {
  return items
    .map(
      ([heading, detail], i) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td valign="top" width="26" style="width:26px;padding:1px 0 0;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td class="dg-num" width="24" height="24" align="center" valign="middle" bgcolor="${C.navy}" style="width:24px;height:24px;background:${C.navy};border-radius:12px;font-family:${SANS};font-size:12px;font-weight:bold;line-height:24px;color:#ffffff;">${i + 1}</td></tr></table>
              </td>
              <td valign="top" style="padding:0 0 16px 14px;">
                <p class="dg-text" style="margin:0;font-family:${SANS};font-size:15px;font-weight:bold;line-height:1.5;color:${C.text};">${heading}</p>
                <p class="dg-muted" style="margin:2px 0 0;font-family:${SANS};font-size:13px;line-height:1.55;color:${C.muted};">${detail}</p>
              </td>
            </tr>
          </table>`,
    )
    .join("\n          ");
}

function signature() {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 0;">
            <tr>
              <td valign="top" style="padding-right:14px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="2" height="40" bgcolor="${C.gold}" style="width:2px;height:40px;background:${C.gold};font-size:0;line-height:0;">&nbsp;</td></tr></table>
              </td>
              <td valign="top">
                <p class="dg-title" style="margin:0;font-family:${SERIF};font-size:17px;line-height:1.3;color:${C.navy};">Equipe ${BRAND}</p>
                <p class="dg-muted" style="margin:3px 0 0;font-family:${SANS};font-size:13px;line-height:1.4;color:${C.muted};">${INSTITUTION}</p>
              </td>
            </tr>
          </table>`;
}

const divider = () =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0;"><tr><td class="dg-rule" style="border-top:1px solid ${C.line};font-size:0;line-height:0;height:1px;">&nbsp;</td></tr></table>`;

function supportBlock(supportEmail) {
  if (!supportEmail) return "";
  const address = esc(supportEmail);
  return muted(
    `Precisa de ajuda? Escreva para <a class="dg-link" href="mailto:${address}" style="color:${C.navy600};text-decoration:underline;">${address}</a>.`,
    { size: 12, margin: "0 0 10px" },
  );
}

/* ------------------------------------------------------------------ */
/* Layout                                                              */

function layout({ pageTitle, preheader, body, notice, vars, supportEmail }) {
  const spacer = "&#8199;&#65279;&#847; ".repeat(40);
  return `<!DOCTYPE html>
<!-- GERADO por supabase/templates/build.mjs — não edite à mão. -->
<html lang="pt-BR" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${pageTitle}</title>
<style>
  body { margin: 0; padding: 0; width: 100% !important; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
  table { border-collapse: collapse; }
  a { color: ${C.navy600}; }
  @media only screen and (max-width: 620px) {
    .dg-outer { padding: 16px 8px 24px !important; }
    .dg-container { width: 100% !important; }
    .dg-header { padding: 28px 24px 24px !important; }
    .dg-pad { padding-left: 24px !important; padding-right: 24px !important; }
    .dg-title-main { font-size: 25px !important; }
    .dg-btn-wrap, .dg-btn { width: 100% !important; }
    .dg-col { display: block !important; width: 100% !important; padding: 0 0 12px !important; }
    .dg-btn a { display: block !important; padding-left: 16px !important; padding-right: 16px !important; }
  }
  @media (prefers-color-scheme: dark) {
    .dg-page { background: #0e151c !important; }
    .dg-card { background: #151f2a !important; }
    .dg-footer { background: #111a23 !important; border-color: #263545 !important; }
    .dg-text { color: #e6ebf1 !important; }
    .dg-muted { color: #aab4bf !important; }
    .dg-title { color: #ffffff !important; }
    .dg-eyebrow { color: ${C.gold300} !important; }
    .dg-panel { background: #1b2836 !important; border-color: #2c3d50 !important; }
    .dg-box { background: #151f2a !important; border-color: #2c3d50 !important; border-top-color: ${C.gold} !important; }
    .dg-rule { border-color: #263545 !important; }
    .dg-link { color: ${C.gold300} !important; }
    .dg-num { background: ${C.gold} !important; color: ${C.navy} !important; }
    .dg-btn { background: ${C.gold} !important; }
    .dg-btn a { color: ${C.navy} !important; }
  }
</style>
</head>
<body class="dg-page" style="margin:0;padding:0;background:${C.page};">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${C.page};">${preheader}${spacer}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="dg-page" bgcolor="${C.page}" style="width:100%;background:${C.page};">
  <tr>
    <td align="center" class="dg-outer" style="padding:40px 16px 32px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="dg-container" style="width:600px;max-width:100%;">
        <tr>
          <td class="dg-header" bgcolor="${C.navy}" style="background:${C.navy};border-radius:10px 10px 0 0;border-bottom:3px solid ${C.gold};padding:36px 48px 30px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td aria-hidden="true" width="34" height="34" align="center" valign="middle" style="width:34px;height:34px;border:1px solid ${C.gold};border-radius:3px;font-family:${SERIF};font-size:14px;font-weight:bold;line-height:34px;color:${C.gold300};">DG</td>
                <td valign="middle" style="padding-left:14px;font-family:${SERIF};font-size:20px;line-height:1;letter-spacing:4px;color:#ffffff;white-space:nowrap;">DG&nbsp;BRASIL</td>
              </tr>
            </table>
            <p style="margin:18px 0 0;font-family:${SANS};font-size:13px;line-height:1.5;letter-spacing:0.2px;color:${C.onNavy};">${TAGLINE}</p>
          </td>
        </tr>
        <tr>
          <td class="dg-card dg-pad" bgcolor="#ffffff" style="background:#ffffff;padding:44px 48px 40px;">
          ${body}
          </td>
        </tr>
        <tr>
          <td class="dg-footer dg-pad" bgcolor="${C.footer}" style="background:${C.footer};border-top:1px solid ${C.line};border-radius:0 0 10px 10px;padding:24px 48px 26px;">
          ${muted(notice, { size: 12, margin: "0 0 10px" })}
          ${supportBlock(supportEmail)}
          ${muted(`Mensagem enviada para ${vars.email}.`, { size: 12, margin: "0" })}
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:24px 16px 0;">
            <p class="dg-muted" style="margin:0;font-family:${SERIF};font-size:12px;line-height:1.6;letter-spacing:3px;color:${C.muted};">DG&nbsp;BRASIL</p>
            <p class="dg-muted" style="margin:2px 0 0;font-family:${SANS};font-size:12px;line-height:1.6;color:${C.muted};">${TAGLINE}</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>
`;
}

/* ------------------------------------------------------------------ */
/* Conteúdo                                                            */

/**
 * Perfil de cada papel, como a pessoa convidada vai encontrá-lo. Resumo de
 * ROLE_DESCRIPTION (apps/frontend/src/lib/permissions) — mudou lá, ajuste aqui.
 */
const ROLE_COPY = {
  ADMIN: { label: "Administrador(a)", detail: `Acesso completo à plataforma, incluindo Financeiro, Parceiros, a Central do ${BRAND} e a gestão da equipe.` },
  LAWYER: { label: "Advogado(a)", detail: "Clientes, casos (com aceite e rejeição), processos, revisões e parceiros." },
  ASSISTANT: { label: "Assistente", detail: "Cadastro e acompanhamento de clientes, casos e processos." },
  PARTNER_ADMIN: {
    label: "Administrador(a) do escritório",
    detail: "Clientes, processos, documentos e pendências do escritório, a participação financeira da parceria e a gestão dos usuários da sua equipe.",
  },
  PARTNER_USER: { label: "Integrante da equipe", detail: "Clientes, processos, documentos e pendências do escritório." },
};

/** Cartão "Seu acesso": escritório + perfil. */
function accessCard(organization, role) {
  const label = (value) =>
    `<p class="dg-muted" style="margin:0 0 4px;font-family:${SANS};font-size:11px;font-weight:bold;line-height:1.4;letter-spacing:1.5px;text-transform:uppercase;color:${C.muted};">${value}</p>`;
  const value = (html) => `<p class="dg-title" style="margin:0;font-family:${SERIF};font-size:17px;line-height:1.35;color:${C.navy};">${html}</p>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="dg-box" bgcolor="#ffffff" style="width:100%;background:#ffffff;border:1px solid ${C.line};border-top:3px solid ${C.navy};border-radius:8px;margin:8px 0 24px;">
            <tr><td style="padding:20px 24px 18px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td class="dg-col" valign="top" width="55%" style="width:55%;padding:0 16px 0 0;">${label("Escritório")}${value(organization)}</td>
                  <td class="dg-col" valign="top" width="45%" style="width:45%;">${label("Perfil de acesso")}${value(ROLE_COPY[role].label)}</td>
                </tr>
              </table>
              ${muted(ROLE_COPY[role].detail, { margin: "14px 0 0" })}
            </td></tr>
          </table>`;
}

const INTERNAL_ROLES = ["ADMIN", "LAWYER", "ASSISTANT"];

/** Variações por papel; os três papéis internos compartilham o texto. */
function perRole(vars, { internal, partnerAdmin, partnerUser, fallback }) {
  return vars.byRole({
    ...Object.fromEntries(INTERNAL_ROLES.map((role) => [role, internal(role)])),
    PARTNER_ADMIN: partnerAdmin,
    PARTNER_USER: partnerUser,
    fallback,
  });
}

/**
 * Convite. Uma mensagem para cada público:
 *  - equipe da Bárbara Cardoso Advocacia (ADMIN, LAWYER, ASSISTANT);
 *  - administrador(a) de escritório parceiro (PARTNER_ADMIN), que depois
 *    convida a própria equipe;
 *  - integrante de escritório parceiro (PARTNER_USER).
 * Papel e escritório vêm de `user_metadata` (gravados em team-actions.ts);
 * convites sem esses dados recebem o texto genérico de parceria.
 */
function invite(vars, config) {
  const href = vars.href("invite");
  const partnerIntro = text(
    `Estamos felizes em iniciar esta parceria e em apresentar o ${BRAND}, nossa plataforma desenvolvida para oferecer uma experiência de trabalho organizada, integrada e profissional.`,
  );
  const partnerOrg = vars.org((name) => name, "Escritório parceiro");

  const intro = perRole(vars, {
    internal: (role) => `${text(`É um prazer receber você na equipe da ${INSTITUTION}.`)}
          ${text(`No ${BRAND}, nossa equipe organiza clientes, casos e processos e acompanha o trabalho com os escritórios parceiros, em um ambiente integrado, seguro e profissional.`)}
          ${accessCard(vars.org((name) => name, INSTITUTION), role)}`,
    partnerAdmin: `${text(
      vars.org(
        (name) => `É um prazer receber o escritório <strong>${name}</strong> como parceiro da ${INSTITUTION}.`,
        `É um prazer receber você na rede de parceiros da ${INSTITUTION}.`,
      ),
    )}
          ${partnerIntro}
          ${text("Você será a pessoa responsável pela conta do escritório na plataforma. Depois de concluir seu acesso, poderá convidar e gerenciar os usuários da sua equipe.")}
          ${accessCard(partnerOrg, "PARTNER_ADMIN")}`,
    partnerUser: `${text(
      vars.org(
        (name) => `Você recebeu um convite para integrar a equipe do escritório <strong>${name}</strong> no ${BRAND}, a plataforma de parceiros da ${INSTITUTION}.`,
        `Você recebeu um convite para integrar a equipe de um escritório parceiro no ${BRAND}, a plataforma de parceiros da ${INSTITUTION}.`,
      ),
    )}
          ${text(`Aqui, o seu escritório e a ${INSTITUTION} trabalham de forma organizada e integrada, com clientes, processos e documentos em um só lugar.`)}
          ${accessCard(partnerOrg, "PARTNER_USER")}`,
    fallback: `${text(`É um prazer receber você na rede de parceiros da ${INSTITUTION}.`)}
          ${partnerIntro}`,
  });

  const kicker = perRole(vars, {
    internal: () => "Convite para a equipe",
    partnerAdmin: "Convite de parceria",
    partnerUser: "Convite de acesso",
    fallback: "Convite de acesso",
  });
  const closing = perRole(vars, {
    internal: () => "Estamos felizes em ter você conosco e desejamos um excelente trabalho.",
    partnerAdmin: "Estamos felizes em ter você conosco e desejamos uma excelente experiência nesta nova parceria.",
    partnerUser: `Estamos felizes em ter você conosco e desejamos uma excelente experiência no ${BRAND}.`,
    fallback: "Estamos felizes em ter você conosco e desejamos uma excelente experiência nesta nova parceria.",
  });

  const body = `${eyebrow(kicker)}
          ${title("Boas-vindas ao DG Brasil")}
          ${text(vars.greeting, { size: 16, extra: "font-weight:bold;" })}
          ${intro}
          ${text("Seu convite já está disponível. Para começar, clique no botão abaixo e siga as etapas de configuração da sua conta.", { margin: "0 0 8px" })}
          ${button(href, "Aceitar convite")}
          ${panel(`${panelTitle("Seu primeiro acesso em três etapas")}
          ${steps([
            ["Crie sua senha", "Confirme seu nome e defina a senha de acesso."],
            ["Aceite os termos de uso", "Leia e aceite os documentos da plataforma."],
            ["Ative a verificação em duas etapas", "Vincule um aplicativo autenticador do seu celular à conta."],
          ])}
          ${muted(`Concluídas as etapas, seu acesso ao ${BRAND} estará liberado.`, { margin: "0 0 14px" })}`)}
          ${divider()}
          ${text(closing, { margin: "0" })}
          ${signature()}
          ${divider()}
          ${fallbackLink(href, vars.linkText("invite"))}`;
  return layout({
    pageTitle: `Seu convite para o ${BRAND}`,
    preheader: `Seu acesso ao ${BRAND} está pronto para ser configurado.`,
    body,
    notice:
      "Este convite é individual e deve ser usado apenas por quem o recebeu. O link tem validade limitada e pode ser usado uma única vez; se ele expirar, peça um novo convite a quem enviou. Se você não esperava este convite, basta ignorar esta mensagem.",
    vars,
    supportEmail: config.supportEmail,
  });
}

/**
 * Também chega a quem é convidado com uma conta JÁ CONFIRMADA no Auth (ex.:
 * acesso removido e depois reconvidado), via `resetPasswordForEmail` em
 * team-actions.ts. Por isso a nota final orienta esse caso.
 */
function recovery(vars, config) {
  const href = vars.href("recovery");
  const body = `${eyebrow("Segurança da conta")}
          ${title("Redefinição de senha")}
          ${text(vars.greeting, { size: 16, extra: "font-weight:bold;" })}
          ${text(`Recebemos uma solicitação para redefinir a senha da sua conta no ${BRAND}.`)}
          ${text("Para continuar, clique no botão abaixo. Você seguirá para o ambiente seguro de redefinição de senha.", { margin: "0 0 8px" })}
          ${button(href, "Redefinir minha senha")}
          ${panel(
            `${panelTitle("Por segurança")}
          ${muted("Este link tem validade limitada e pode ser usado uma única vez. Se a verificação em duas etapas estiver ativa, o código do seu aplicativo autenticador será solicitado antes da nova senha.", { size: 14, margin: "0 0 14px" })}`,
            { accent: true },
          )}
          ${text("<strong>Não reconhece esta solicitação?</strong> Ignore este e-mail. Sua senha atual continua valendo enquanto nenhuma redefinição for concluída.", { margin: "24px 0 0", size: 14 })}
          ${signature()}
          ${divider()}
          ${fallbackLink(href, vars.linkText("recovery"))}`;
  return layout({
    pageTitle: `Redefinição de senha | ${BRAND}`,
    preheader: `Use o link seguro para criar uma nova senha no ${BRAND}.`,
    body,
    notice: `Recebeu esta mensagem depois de um convite para o ${BRAND}? Use o mesmo botão para concluir seu primeiro acesso.`,
    vars,
    supportEmail: config.supportEmail,
  });
}

const TEMPLATES = { "invite.html": invite, "recovery.html": recovery };

/* ------------------------------------------------------------------ */
/* Verificações do resultado (Go template)                             */

function validate(name, html) {
  const type = name === "invite.html" ? "invite" : "recovery";
  const problems = [];
  const opens = (html.match(/\{\{-?\s*(if|with|range)\b/g) ?? []).length;
  const ends = (html.match(/\{\{-?\s*end\s*-?\}\}/g) ?? []).length;
  if (opens !== ends) problems.push(`blocos Go desbalanceados (${opens} abertos, ${ends} fechados)`);
  if (!html.includes(`href="${GO.href(type)}"`)) problems.push("link oficial ausente ou alterado");
  if (/\.ConfirmationURL/.test(html)) problems.push("usa .ConfirmationURL (fluxo implícito não funciona com o login SSR)");
  if (/<!--\[if/i.test(html)) problems.push("comentário condicional (removido pelo html/template)");
  if (/localhost|127\.0\.0\.1/.test(html)) problems.push("URL de desenvolvimento no template");
  if (/<script/i.test(html)) problems.push("JavaScript em e-mail");
  const kb = Buffer.byteLength(html, "utf8") / 1024;
  if (kb > 90) problems.push(`${kb.toFixed(1)} KB — o Gmail corta mensagens acima de ~102 KB`);
  return problems;
}

/* ------------------------------------------------------------------ */
/* Preview                                                             */

const PARTNER_SAMPLE_ORG = "Almeida & Prado Advogados";
const SAMPLES = {
  invite: [
    { key: "parceiro-admin", label: "Administrador(a) de escritório parceiro", role: "PARTNER_ADMIN", firstName: "Mariana", org: PARTNER_SAMPLE_ORG, email: "mariana@almeidaprado.adv.br" },
    { key: "parceiro-usuario", label: "Integrante de escritório parceiro (convidado pelo administrador do parceiro)", role: "PARTNER_USER", firstName: "Juliana", org: PARTNER_SAMPLE_ORG, email: "juliana@almeidaprado.adv.br" },
    { key: "advogado", label: "Advogado(a) da equipe da Bárbara Cardoso Advocacia", role: "LAWYER", firstName: "Rafael", org: INSTITUTION, email: "rafael@barbaracardoso.adv.br" },
    { key: "assistente", label: "Assistente da equipe da Bárbara Cardoso Advocacia", role: "ASSISTANT", firstName: "Camila", org: INSTITUTION, email: "camila@barbaracardoso.adv.br" },
    { key: "administrador", label: "Administrador(a) da Bárbara Cardoso Advocacia", role: "ADMIN", firstName: "Helena", org: INSTITUTION, email: "helena@barbaracardoso.adv.br" },
    { key: "sem-dados", label: "Sem nome nem papel (convite antigo — fallback)", role: "", firstName: "", org: "", email: "contato@escritorio-parceiro.com.br" },
  ],
  recovery: [
    { key: "com-nome", label: "Com nome", firstName: "Mariana", email: "mariana@almeidaprado.adv.br" },
    { key: "sem-nome", label: "Sem nome (fallback)", firstName: "", email: "contato@escritorio-parceiro.com.br" },
  ],
};

function writePreviews(outDir, config) {
  mkdirSync(outDir, { recursive: true });
  const cards = [];
  for (const [file, render] of Object.entries(TEMPLATES)) {
    const base = file.replace(".html", "");
    for (const sample of SAMPLES[base]) {
      const html = render(previewVars(sample), config);
      writeFileSync(join(outDir, `${base}-${sample.key}.html`), html);
      cards.push({ base, file: `${base}-${sample.key}.html`, label: sample.label });
    }
    // Modo escuro forçado (como Apple Mail / iOS Mail com tema escuro).
    const dark = render(previewVars(SAMPLES[base][0]), config).replace("@media (prefers-color-scheme: dark)", "@media all");
    writeFileSync(join(outDir, `${base}-escuro.html`), dark);
    cards.push({ base, file: `${base}-escuro.html`, label: "Modo escuro (clientes que respeitam prefers-color-scheme)" });
  }
  const section = (base, heading) => `
  <section>
    <h2>${heading}</h2>
    ${cards
      .filter((c) => c.base === base)
      .map(
        (c) => `<div class="row">
      <h3>${c.label} · <a href="${c.file}" target="_blank">abrir sozinho</a></h3>
      <div class="frames">
        <figure><figcaption>Desktop · 680 px</figcaption><iframe src="${c.file}" style="width:680px" loading="lazy"></iframe></figure>
        <figure><figcaption>Celular · 375 px</figcaption><iframe src="${c.file}" style="width:375px" loading="lazy"></iframe></figure>
      </div>
    </div>`,
      )
      .join("\n")}
  </section>`;
  writeFileSync(
    join(outDir, "index.html"),
    `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>DG Brasil — e-mails</title>
<style>
  body{margin:0;padding:32px;background:#e9ecef;font-family:system-ui,sans-serif;color:#18222d}
  h1{font-size:20px;margin:0 0 4px} p.sub{margin:0 0 24px;color:#5f6b79;font-size:14px}
  h2{font-size:17px;margin:40px 0 12px;padding-top:16px;border-top:1px solid #c7ced6}
  h3{font-size:13px;font-weight:600;margin:20px 0 8px;color:#33506d}
  .frames{display:flex;gap:24px;align-items:flex-start;flex-wrap:wrap}
  figure{margin:0} figcaption{font-size:12px;color:#5f6b79;margin-bottom:6px}
  iframe{height:1180px;border:1px solid #c7ced6;border-radius:8px;background:#fff}
</style></head><body>
<h1>DG Brasil — pré-visualização dos e-mails</h1>
<p class="sub">Gerado por supabase/templates/build.mjs com dados de exemplo. Links desativados para envio real; ${config.supportEmail ? "seção de suporte ATIVA" : "sem e-mail de suporte configurado (seção oculta)"}.</p>
${section("invite", "Convite de primeiro acesso — “Seu convite para o DG Brasil | Bárbara Cardoso Advocacia”")}
${section("recovery", "Redefinição de senha — “Redefinição de senha | DG Brasil”")}
</body></html>
`,
  );
  return join(outDir, "index.html");
}

/* ------------------------------------------------------------------ */

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function main() {
  const args = process.argv.slice(2);
  const config = loadConfig();

  if (args[0] === "--preview") {
    if (!args[1]) fail("informe a pasta: --preview <pasta>");
    console.log(`✓ pré-visualização: ${writePreviews(resolve(args[1]), config)}`);
    return;
  }

  const check = args[0] === "--check";
  let failed = false;
  for (const [file, render] of Object.entries(TEMPLATES)) {
    const html = render(GO, config);
    const problems = validate(file, html);
    const path = join(DIR, file);
    if (check && (!existsSync(path) || readFileSync(path, "utf8").replace(/\r\n/g, "\n") !== html)) {
      problems.push("desatualizado — rode `npm run emails` e faça commit");
    }
    if (problems.length) {
      failed = true;
      problems.forEach((p) => console.error(`✗ ${file}: ${p}`));
      continue;
    }
    if (!check) writeFileSync(path, html);
    console.log(`✓ ${file} (${(Buffer.byteLength(html, "utf8") / 1024).toFixed(1)} KB)`);
  }
  if (failed) process.exit(1);
}

main();
