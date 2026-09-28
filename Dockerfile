FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json tsconfig*.json ./
COPY packages ./packages
COPY apps ./apps
RUN npm install --no-audit --no-fund
RUN npm run build

FROM node:22-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium ca-certificates fonts-liberation \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production \
    CHROME_EXECUTABLE_PATH=/usr/bin/chromium \
    HEADLESS=true
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps ./apps
EXPOSE 8787
CMD ["node", "apps/api/dist/server.js"]
