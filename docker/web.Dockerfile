FROM node:20-slim
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @aaa/web run build
WORKDIR /app/apps/web
EXPOSE 3000
CMD ["pnpm", "start"]
