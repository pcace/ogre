FROM node:24-alpine AS node
ENV PNPM_HOME="/usr/local/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && mkdir -p $PNPM_HOME

FROM ghcr.io/osgeo/gdal:alpine-small-3.11.0

# Install Node.js and npm directly in the Alpine-based GDAL image
RUN apk add --no-cache nodejs npm

# Set up pnpm directly (without corepack)
ENV PNPM_HOME="/usr/local/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN mkdir -p $PNPM_HOME && \
    npm install -g pnpm

# Create app directory
WORKDIR /app

# Copy your application
COPY . .

# Use pnpm instead of npm
RUN pnpm install
RUN pnpm install -g ts-node typescript
RUN pnpm add -D @types/node

EXPOSE 3000
CMD [ "pnpm", "start" ]