FROM node:20-slim
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm -r --filter @aaa/worker... run build
WORKDIR /app/apps/worker
EXPOSE 9090
CMD ["node", "dist/index.js"]
