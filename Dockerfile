# Compiler container
FROM node:16-alpine AS compiler
RUN apk add --no-cache build-base git bash
WORKDIR /usr/src/app
COPY . ./
RUN npm i --no-audit
RUN npm run dist

# Runtime container
FROM node:16-alpine
RUN apk add --no-cache bash
RUN mkdir -p /srv/app && chown node:node /srv/app \
 && mkdir -p /srv/data && chown node:node /srv/data
WORKDIR /srv/app
RUN chmod 777 /srv/app
COPY --from=compiler /usr/src/app/node_modules ./node_modules/
COPY --from=compiler /usr/src/app/dist ./dist/
COPY --from=compiler /usr/src/app/config ./config/
COPY package*.json ./
EXPOSE 8090
ENV NODE_ENV $NODE_ENV
CMD ["node", "dist/commands/Start.js"]
