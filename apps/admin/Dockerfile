FROM node:24-bookworm-slim AS build
WORKDIR /app
ARG VITE_HR_FEATURES_ENABLED=true
ENV VITE_HR_FEATURES_ENABLED=$VITE_HR_FEATURES_ENABLED
COPY package.json package-lock.json ./
COPY apps/admin/package.json apps/admin/package.json
RUN npm ci --workspace admin --include-workspace-root=false --registry=https://registry.npmmirror.com
COPY apps/admin apps/admin
COPY apps/miniapp/src/static/module-icons apps/miniapp/src/static/module-icons
COPY apps/miniapp/src/static/tabbar apps/miniapp/src/static/tabbar
RUN npm run build -w admin

FROM node:24-bookworm-slim
WORKDIR /app
COPY apps/admin/server.mjs ./server.mjs
COPY --from=build /app/apps/admin/dist ./dist
EXPOSE 80
CMD ["node", "server.mjs"]
