# syntax=docker/dockerfile:1

FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY index.html tsconfig.json tsconfig.app.json tsconfig.node.json vite.config.ts ./
COPY src ./src
RUN npm run build

FROM nginx:alpine

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
# base: '/DRT_visualization_dashboard/' — 자산 경로와 맞추어 하위 디렉터리에 배치
COPY --from=builder /app/dist /usr/share/nginx/html/DRT_visualization_dashboard

EXPOSE 8080
