FROM node:26-alpine

WORKDIR /app

# node:26-alpine ships neither yarn nor corepack, unlike node:20-alpine which
# bundled yarn 1.22.22. Install the same yarn package.json already declares.
RUN npm install -g yarn@1.22.22

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production

COPY src ./src

CMD ["npm", "start"]
