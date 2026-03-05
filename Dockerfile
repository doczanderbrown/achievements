FROM node:22-alpine AS build
WORKDIR /app

ARG VITE_BASE_PATH=/tools/

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build -- --base="${VITE_BASE_PATH}"

FROM nginx:1.29-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY site/. /usr/share/nginx/html/
COPY --from=build /app/dist /usr/share/nginx/html/tools

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/tools/ >/dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]
