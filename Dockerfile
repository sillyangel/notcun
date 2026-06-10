FROM node:24-alpine

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

COPY index.html ./index.html
COPY src ./src
COPY server.js ./server.js

ENV PORT=80

EXPOSE 80

CMD ["pnpm", "start"]