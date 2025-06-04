FROM node:24-slim AS node
ENV PNPM_HOME="/usr/local/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && mkdir -p $PNPM_HOME

# FROM ghcr.io/osgeo/gdal:alpine-small-3.11.0
FROM ghcr.io/osgeo/gdal:ubuntu-full-latest

# Install Node.js and npm from NodeSource repository
RUN apt-get update && apt-get install -y curl gnupg && \
    mkdir -p /etc/apt/keyrings && \
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg && \
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list && \
    apt-get update && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

# Set up pnpm directly (without corepack)
ENV PNPM_HOME="/usr/local/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN mkdir -p $PNPM_HOME && \
    npm install -g pnpm

# Create app directory
WORKDIR /app

# Copy package files first for better layer caching
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install
RUN pnpm install -g ts-node typescript

# Copy the rest of the application
COPY . .

EXPOSE 3000
CMD [ "pnpm", "start" ]