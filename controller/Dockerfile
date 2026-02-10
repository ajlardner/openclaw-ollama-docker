FROM node:22-alpine

RUN apk add --no-cache curl wget

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY *.js ./

RUN mkdir -p /data/logs/snapshots /data/agents

EXPOSE 9090

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:9090/limits || exit 1

CMD ["node", "server.js"]
