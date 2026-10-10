FROM public.ecr.aws/docker/library/node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG VITE_API_URL=/api
ENV VITE_API_URL=${VITE_API_URL}

RUN npm run build

ENV NODE_ENV=production
ENV PATH="/app/node_modules/.bin:$PATH"

CMD ["node", "dist-server/index.js"]
