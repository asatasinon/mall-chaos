FROM node:22-alpine

RUN apk add --no-cache docker-cli

WORKDIR /app
COPY server.mjs .

EXPOSE 8095
ENTRYPOINT ["node", "/app/server.mjs"]