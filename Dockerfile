FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm run build:server

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# pdftotext für die Volltextsuche in PDFs
RUN apk add --no-cache poppler-utils
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/server.js ./server.js
EXPOSE 3000
CMD ["node", "server.js"]
