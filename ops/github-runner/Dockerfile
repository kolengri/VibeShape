FROM node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS node

FROM ghcr.io/actions/actions-runner:2.338.0@sha256:4ffadc0002b2581327e06101fc8c06cd189232baf79fe561fac9caeb76f5e807

USER root
COPY --chmod=755 clean-workspace.sh /opt/vibeshape-runner/clean-workspace.sh
ENV ACTIONS_RUNNER_HOOK_JOB_STARTED=/opt/vibeshape-runner/clean-workspace.sh
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
RUN apt-get update && apt-get install -y --no-install-recommends \
    gh python3 build-essential ca-certificates \
    && rm -rf /var/lib/apt/lists/*
USER runner

# Registration credentials live only in this container, never in the image.
CMD ["./run.sh"]
