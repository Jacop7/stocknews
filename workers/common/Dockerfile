FROM node:24.15.0-bookworm-slim@sha256:4e6b70dd6cbfc88c8157ba19aa3d9f9cce6ba4703576d55459e45efcbc9c5f5d
WORKDIR /opt/judoju
ARG JUDOJU_BOOTSTRAP
LABEL com.judoju.product="judoju-news" com.judoju.bootstrap="$JUDOJU_BOOTSTRAP"
COPY worker.mjs mock.mjs ./
RUN mkdir -p /data/receipts && chown -R node:node /data /opt/judoju
USER node
CMD ["node", "worker.mjs"]
