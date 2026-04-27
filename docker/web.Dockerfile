FROM node:20-slim
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
ARG NEXT_PUBLIC_API_URL
ARG WEB_BASE_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV WEB_BASE_URL=$WEB_BASE_URL
RUN pnpm --filter @aaa/web run build
WORKDIR /app/apps/web
EXPOSE 3000
CMD ["pnpm", "start"]
