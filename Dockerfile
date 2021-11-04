# Compiler container
FROM node:12-alpine AS compiler
RUN apk add --no-cache build-base git python
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci
COPY . ./
# Runtime container
FROM node:12.18.1
RUN mkdir -p /srv/app && chown node:node /srv/app \
 && mkdir -p /srv/data && chown node:node /srv/data
USER node
WORKDIR /srv/app
COPY --from=compiler --chown=node:node /usr/src/app/node_modules ./node_modules/
COPY --chown=node:node package*.json ./
COPY --chown=node:node server-config.json ./
COPY --chown=node:node bin ./bin/
RUN chmod -R 777 ./bin/
COPY --chown=node:node dist ./dist/
RUN chmod -R 777 ./dist/
EXPOSE 8090
RUN ls -lah ./bin/
CMD [ “sh”, “./bin/start” ]