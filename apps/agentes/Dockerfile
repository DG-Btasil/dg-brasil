# Worker de agentes do DG Brasil.
#
# Imagem mínima, sem segredo nenhum: chaves (DATABASE_URL do dg_worker,
# SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY) entram só em tempo de execução,
# pelos secrets do Fly.io. Roda como usuário sem privilégio (node).
#
# Os scripts das skills NÃO rodam aqui: rodam no ambiente isolado do
# provedor (execução de código da Anthropic). Por isso a imagem não tem
# Python, shell de agente nem nada além do Node e das dependências.

FROM node:22.20.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev --ignore-scripts

FROM node:22.20.0-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
USER node
EXPOSE 8080
# Encerramento gracioso: o worker para de reservar no SIGTERM e termina o atual.
STOPSIGNAL SIGTERM
CMD ["node", "dist/index.js"]
