# Compiler container
FROM node:16-alpine AS compiler
RUN apk add --no-cache build-base git bash
WORKDIR /usr/src/app
COPY / ./

# Runtime container
FROM node:16-alpine
RUN apk add --no-cache bash
RUN mkdir -p /srv/app && chown node:node /srv/app \
 && mkdir -p /srv/data && chown node:node /srv/data
USER node
WORKDIR /srv/app
COPY --from=compiler --chown=node:node /usr/src/app/node_modules ./node_modules/
COPY --chown=node:node package*.json ./
COPY --chown=node:node server-config*.json ./
COPY --chown=node:node dist ./dist/
COPY --chown=node:node scripts ./scripts/
EXPOSE 8090
