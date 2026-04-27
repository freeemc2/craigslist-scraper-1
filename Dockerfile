# 1. Builder Stage
FROM apify/actor-node-playwright-chrome:20 AS builder

# Copy package files
COPY --chown=myuser package*.json ./

# Install all dependencies including dev
RUN npm install --include=dev --audit=false

# Copy source files
COPY --chown=myuser . ./

# Build the project (converts TS to JS)
RUN npm run build

# 2. Final Run Stage
# CHANGE THIS LINE FROM :16 TO :20
FROM apify/actor-node-playwright-chrome:20

# Copy only built JS files from builder image
COPY --from=builder --chown=myuser /home/myuser/dist ./dist

# Copy package files for production install
COPY --chown=myuser package*.json ./

# Install production dependencies only
RUN npm --quiet set progress=false \
    && npm install --omit=dev --omit=optional \
    && echo "Node.js version:" \
    && node --version

# Copy the rest of the source (needed for metadata/configs)
COPY --chown=myuser . ./

# Run the image
# Note: Ensure "start:cloud" is defined in your package.json scripts
CMD npm run start:cloud --silent
