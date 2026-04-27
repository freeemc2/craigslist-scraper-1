FROM apify/actor-node-playwright-chrome:20 AS builder
COPY --chown=myuser package*.json ./
RUN npm install --include=dev
COPY --chown=myuser . ./
# Ensure the dist directory exists
RUN mkdir -p dist
RUN npm run build

FROM apify/actor-node-playwright-chrome:20
COPY --from=builder --chown=myuser /home/myuser/dist ./dist
COPY --chown=myuser package*.json ./
RUN npm install --omit=dev
COPY --chown=myuser . ./
CMD ["npm", "run", "start:cloud"]
