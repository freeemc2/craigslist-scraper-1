FROM apify/actor-node-playwright-chrome:20 AS builder
COPY --chown=myuser package*.json ./
RUN npm install --include=dev --audit=false
COPY --chown=myuser . ./
RUN npm run build

FROM apify/actor-node-playwright-chrome:20
COPY --from=builder --chown=myuser /home/myuser/dist ./dist
COPY --chown=myuser package*.json ./
RUN npm --quiet set progress=false \
    && npm install --omit=dev --omit=optional \
    && echo "Node.js version:" \
    && node --version
COPY --chown=myuser . ./
CMD npm run start:cloud --silentCMD npm run start:cloud --silent
