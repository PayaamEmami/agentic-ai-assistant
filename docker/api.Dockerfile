FROM node:20-slim
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm -r --filter @aaa/api... run build
WORKDIR /app/apps/api
EXPOSE 3001
CMD ["node", "dist/index.js"]
