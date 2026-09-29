FROM node:24-bookworm-slim AS base
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

FROM base AS build
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/report-engine/package.json packages/report-engine/package.json
RUN npm ci --registry=https://registry.npmmirror.com
COPY tsconfig.base.json ./
COPY apps/api apps/api
COPY packages/report-engine packages/report-engine
COPY database/prisma database/prisma
RUN chmod -R a+rX database/prisma
RUN npm run prisma:generate && npm run build

FROM base
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/packages/report-engine/dist ./packages/report-engine/dist
COPY --from=build /app/database/prisma ./database/prisma
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/report-engine/package.json packages/report-engine/package.json
EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy --schema database/prisma/schema.prisma && exec su -s /bin/sh node -c 'node apps/api/dist/main.js'"]
