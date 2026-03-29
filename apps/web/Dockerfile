FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/shared-ui/package.json ./packages/shared-ui/
COPY packages/web-client/package.json ./packages/web-client/
COPY apps/web/package.json ./apps/web/
RUN corepack enable && pnpm install --frozen-lockfile
COPY packages/shared ./packages/shared
COPY packages/shared-ui ./packages/shared-ui
COPY packages/web-client ./packages/web-client
COPY apps/web ./apps/web
RUN pnpm --filter @openAwork/shared build
RUN pnpm --filter @openAwork/shared-ui build
RUN pnpm --filter @openAwork/web-client build
RUN pnpm --filter @openAwork/web build

FROM nginx:alpine
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
