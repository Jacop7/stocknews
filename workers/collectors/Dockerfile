FROM node:24.15.0-bookworm-slim@sha256:4e6b70dd6cbfc88c8157ba19aa3d9f9cce6ba4703576d55459e45efcbc9c5f5d
LABEL com.judoju.product="judoju-news"
WORKDIR /opt/judoju

COPY package.json pnpm-lock.yaml ./
RUN corepack pnpm install --prod --frozen-lockfile --ignore-scripts

COPY scripts/providers/html-list.mjs scripts/providers/html-worker.mjs scripts/providers/listing-progress.mjs scripts/providers/public-watch.mjs scripts/providers/public-metadata.mjs scripts/providers/probe.mjs scripts/providers/policy.mjs scripts/providers/budget.mjs scripts/providers/telegram-link-worker.mjs ./scripts/providers/
COPY data/providers/routes.json data/providers/permission-profiles.json ./data/providers/
RUN install -d -o node -g node /data /telegram-data
ENV JUDOJU_COLLECTOR_DIRECTORY=/data
USER node
CMD ["node", "scripts/providers/html-worker.mjs"]
