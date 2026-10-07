ARG NODE_IMAGE=node:24-bookworm-slim
FROM ${NODE_IMAGE}
ARG BUN_VERSION=1.3.11
ARG STANDARD_VERSION=1.0.37
ARG CORE_VERSION=3.0.45
ARG RUNTIME_VERSION=3.0.45
ARG CLI_VERSION
ARG PLAYWRIGHT_VERSION=1.63.0
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright
# Install native PostgreSQL tools without a distribution-owned cluster; each World owns its own data and lifetime.
# https://manpages.debian.org/bookworm/postgresql-common/pg_createcluster.1.en.html#DEFAULT_VALUES
RUN mkdir -p /etc/postgresql-common && printf 'create_main_cluster = false\n' > /etc/postgresql-common/createcluster.conf \
    && apt-get update && apt-get install -y --no-install-recommends git openssl ca-certificates libfaketime postgresql-15 && rm -rf /var/lib/apt/lists/*
ENV VOLTER_WORLD_POSTGRES_BIN=/usr/lib/postgresql/15/bin
WORKDIR /opt/catalog
RUN npm install --ignore-scripts --no-audit --no-fund --save-exact \
    @oven/bun-linux-x64@${BUN_VERSION} @volter/twin-standard@${STANDARD_VERSION} \
    @volter/world-core@${CORE_VERSION} @volter/world-runtime@${RUNTIME_VERSION} @volter/world@${CLI_VERSION} tar@7.5.7 semver@7.8.5 sigstore@4.1.1 playwright@${PLAYWRIGHT_VERSION}
ENV PATH="/opt/catalog/node_modules/@oven/bun-linux-x64/bin:/opt/catalog/node_modules/.bin:${PATH}"
RUN ./node_modules/.bin/playwright install --with-deps chromium
COPY lib /opt/catalog/lib
COPY runner /opt/catalog/runner
USER node
WORKDIR /work
ENTRYPOINT ["node"]
