ARG BASE_IMAGE_REGISTRY=harbor.cloudwise.com/noname/
FROM ${BASE_IMAGE_REGISTRY}node:22-alpine AS base

RUN apk add --no-cache docker-cli

WORKDIR /app
COPY server.mjs .

EXPOSE 8095
ENTRYPOINT ["node", "/app/server.mjs"]