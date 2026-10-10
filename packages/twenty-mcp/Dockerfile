FROM node:24.16.0-alpine3.23@sha256:2bdb65ed1dab192432bc31c95f94155ca5ad7fc1392fb7eb7526ab682fa5bf14 AS build
WORKDIR /app
COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn/releases .yarn/releases
COPY .yarn/patches .yarn/patches
COPY packages/twenty-mcp/package.json packages/twenty-mcp/package.json
RUN yarn workspaces focus twenty-mcp-server
COPY packages/twenty-mcp/src packages/twenty-mcp/src
RUN yarn workspace twenty-mcp-server exec esbuild src/index.ts --bundle --platform=node --format=cjs --target=node24 --outfile=/app/server.cjs

FROM node:24.16.0-alpine3.23@sha256:2bdb65ed1dab192432bc31c95f94155ca5ad7fc1392fb7eb7526ab682fa5bf14
WORKDIR /app
COPY --from=build --chown=node:node /app/server.cjs ./server.cjs
RUN mkdir -p /state && chown node:node /state && chmod 700 /state
ENV NODE_ENV=production TRANSPORT=http HOST=0.0.0.0 PORT=3333
USER node
EXPOSE 3333
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD node -e "fetch('http://127.0.0.1:3333/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "server.cjs"]
