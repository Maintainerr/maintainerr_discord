# This image is published to a PUBLIC registry
# (ghcr.io/maintainerr/maintainerr_discord) on every push to main, so nothing
# secret may enter it: no ENV secrets, no copied config, no .env. DISCORD_TOKEN
# is injected at runtime by the deployment and is never baked in. Only
# package.json, yarn.lock and src are copied; .dockerignore keeps .env, .env.*,
# .git and README.md out of the build context.

FROM node:26-alpine

WORKDIR /app

# node:26-alpine ships neither yarn nor corepack, unlike node:20-alpine which
# bundled yarn 1.22.22. Install the same yarn package.json already declares.
RUN npm install -g yarn@1.22.22

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production

COPY src ./src

CMD ["npm", "start"]
