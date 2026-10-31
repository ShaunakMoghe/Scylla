FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY web/package.json web/package-lock.json ./web/
RUN npm ci --prefix web

COPY . .
RUN npm run --prefix web build

ENV SCYLLA_PROVIDER=mock
ENV SCYLLA_PUBLIC_DEMO=1
ENV SCYLLA_SERVE_STATIC=1
ENV PORT=4100

EXPOSE 4100

CMD ["npm", "run", "start"]
