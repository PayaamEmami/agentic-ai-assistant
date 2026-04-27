FROM node:20-slim
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm -r --filter @aaa/worker... run build
RUN for pkg in ai knowledge-sources retrieval tool-providers; do \
      if [ -d "packages/$pkg/dist/packages/$pkg/src" ]; then \
        cp -R "packages/$pkg/dist/packages/$pkg/src/." "packages/$pkg/dist/"; \
      fi; \
    done && \
    if [ -d "packages/db/dist/db/src" ]; then \
      cp -R "packages/db/dist/db/src/." "packages/db/dist/"; \
    fi
WORKDIR /app/apps/worker
EXPOSE 9464
CMD ["node", "dist/apps/worker/src/index.js"]
