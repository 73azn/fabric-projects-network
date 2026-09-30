# REST API image. Built and started by ../network.sh api (compose/compose-api.yaml); it joins the
# Fabric Docker network, so it reaches the peers and the orderer by container name.
FROM node:24-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY src ./src

EXPOSE 4000
CMD ["node", "src/server.js"]
