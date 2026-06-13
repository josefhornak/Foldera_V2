# ---- Frontend build ----
FROM node:22-alpine AS frontend
WORKDIR /build
COPY package.json package-lock.json* ./
RUN npm ci || npm install
COPY tsconfig.json vite.config.ts react-router.config.ts ./
COPY app ./app
COPY public ./public
RUN npm run build

# ---- Backend build ----
FROM node:22-alpine AS backend
WORKDIR /build
COPY backend/package.json backend/package-lock.json* ./
RUN npm ci || npm install
COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN npm run build && npm prune --omit=dev

# ---- Runtime ----
FROM node:22-alpine
WORKDIR /srv/app
ENV NODE_ENV=production
COPY --from=backend /build/node_modules ./node_modules
COPY --from=backend /build/dist ./dist
COPY backend/drizzle ./drizzle
COPY backend/drizzle.config.ts ./
COPY backend/assets ./assets
COPY --from=frontend /build/build/client ./public
EXPOSE 3000
CMD ["node", "dist/index.js"]
