FROM node:22-bookworm-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da AS builder
WORKDIR /work
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ENV NODE_OPTIONS=--max-old-space-size=768
RUN npm run measure-build
FROM nginx:stable-alpine@sha256:0e52bd054126cdc040b1276c0af347aeb02a41b9cfe305d6094767ac30e97949
COPY nginx.conf /etc/nginx/nginx.conf
COPY --from=builder /work/dist /usr/share/nginx/html
USER 10001:10001
ENTRYPOINT ["nginx", "-g", "daemon off;"]
