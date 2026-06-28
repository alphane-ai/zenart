FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:24-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ARG NEXT_PUBLIC_ADMIN_API_BASE_URL
ARG NEXT_PUBLIC_ADMIN_AUTH_MODE
ARG NEXT_PUBLIC_ADMIN_BASE_PATH
ARG PUBLIC_ADMIN_ORIGIN
ENV NEXT_PUBLIC_ADMIN_API_BASE_URL=$NEXT_PUBLIC_ADMIN_API_BASE_URL
ENV NEXT_PUBLIC_ADMIN_AUTH_MODE=$NEXT_PUBLIC_ADMIN_AUTH_MODE
ENV NEXT_PUBLIC_ADMIN_BASE_PATH=$NEXT_PUBLIC_ADMIN_BASE_PATH
ENV PUBLIC_ADMIN_ORIGIN=$PUBLIC_ADMIN_ORIGIN
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3001
ARG NEXT_PUBLIC_ADMIN_API_BASE_URL
ARG NEXT_PUBLIC_ADMIN_AUTH_MODE
ARG NEXT_PUBLIC_ADMIN_BASE_PATH
ARG PUBLIC_ADMIN_ORIGIN
ENV NEXT_PUBLIC_ADMIN_API_BASE_URL=$NEXT_PUBLIC_ADMIN_API_BASE_URL
ENV NEXT_PUBLIC_ADMIN_AUTH_MODE=$NEXT_PUBLIC_ADMIN_AUTH_MODE
ENV NEXT_PUBLIC_ADMIN_BASE_PATH=$NEXT_PUBLIC_ADMIN_BASE_PATH
ENV PUBLIC_ADMIN_ORIGIN=$PUBLIC_ADMIN_ORIGIN

RUN apk upgrade --no-cache \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
    && addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3001
CMD ["node", "server.js"]
