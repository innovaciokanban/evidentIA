FROM public.ecr.aws/docker/library/node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

RUN npm run build

ENV NODE_ENV=production

CMD ["node", "dist-server/index.js"]
