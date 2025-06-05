FROM node:24-slim AS node
ENV PNPM_HOME="/usr/local/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && mkdir -p $PNPM_HOME

# FROM ghcr.io/osgeo/gdal:alpine-small-3.11.0
FROM ghcr.io/osgeo/gdal:ubuntu-full-latest

# Install Node.js and npm from NodeSource repository, plus build tools for LibreDWG
RUN apt-get update && apt-get install -y curl gnupg build-essential autoconf automake libtool git texinfo && \
    mkdir -p /etc/apt/keyrings && \
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg && \
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list && \
    apt-get update && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

# Build and install LibreDWG from source (GitHub since GNU FTP doesn't include bindings)
RUN cd /tmp && \
    git clone https://github.com/LibreDWG/libredwg.git && \
    cd libredwg && \
    sh ./autogen.sh && \
    ./configure --disable-bindings --enable-trace && \
    make -j$(nproc) && \
    make install && \
    ldconfig && \
    cd / && \
    rm -rf /tmp/libredwg

# Set up pnpm directly (without corepack)
ENV PNPM_HOME="/usr/local/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN mkdir -p $PNPM_HOME && \
    npm install -g pnpm

# Create a restricted user with minimal permissions
RUN groupadd -r ogre && useradd -r -g ogre -m -s /bin/false ogre && \
    # Create directories with proper ownership
    mkdir -p /app && \
    chown -R ogre:ogre /app && \
    # Remove write permissions for others on user home
    chmod 750 /home/ogre

# Create app directory
WORKDIR /app

# Copy package files first for better layer caching
COPY package.json pnpm-lock.yaml ./

# Install dependencies as root first
RUN pnpm install
RUN pnpm install -g ts-node typescript

# Copy the rest of the application
COPY . .

# Change ownership of app directory to ogre user
RUN chown -R ogre:ogre /app

# Remove unnecessary packages and clean up to reduce attack surface
RUN apt-get remove -y curl gnupg build-essential autoconf automake libtool git && \
    apt-get autoremove -y && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/* && \
    # Further security hardening
    find /usr/bin -type f -perm /u+s -exec chmod u-s {} \; 2>/dev/null || true && \
    find /usr/sbin -type f -perm /u+s -exec chmod u-s {} \; 2>/dev/null || true && \
    # Remove package managers to prevent privilege escalation
    rm -f /usr/bin/apt* /usr/bin/dpkg* 2>/dev/null || true

# Switch to restricted user
USER ogre

# Create temp directory as ogre user and set environment variables for security
RUN mkdir -p /tmp/ogre-uploads && chmod 700 /tmp/ogre-uploads
ENV TMPDIR=/tmp/ogre-uploads
ENV HOME=/home/ogre
ENV GDAL_DISABLE_READDIR_ON_OPEN=EMPTY_DIR
ENV GDAL_DATA=/usr/share/gdal
ENV CPL_TMPDIR=/tmp/ogre-uploads

# Final security check - ensure no SUID/SGID binaries are accessible
RUN find /usr/bin /usr/sbin -type f \( -perm -4000 -o -perm -2000 \) 2>/dev/null | wc -l

# Add healthcheck using wget (available in the GDAL image)
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/ || exit 1

EXPOSE 3000
CMD [ "pnpm", "start" ]