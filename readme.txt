# Twenty CRM commands

## Launch the application

    cd /Users/kasraaliyon/Documents/GitHub/twenty
    bash packages/twenty-utils/setup-dev-env.sh --docker
    yarn start

This starts PostgreSQL and Redis in Docker, prepares the database, and starts
the frontend, backend, and worker. Keep the Terminal open. Twenty runs at:

    http://localhost:2001

One-click Mac launcher for the same process:

    open "$HOME/Desktop/Twenty CRM.app"


## Build the application

    cd /Users/kasraaliyon/Documents/GitHub/twenty
    npx nx build twenty-shared
    npx nx build twenty-ui
    npx nx build twenty-front
    npx nx build twenty-server


## Test the application

Lint:

    npx nx lint:diff-with-main twenty-front
    npx nx lint:diff-with-main twenty-server

Typecheck:

    npx nx typecheck twenty-front
    npx nx typecheck twenty-server

Run one test:

    npx jest path/to/test.test.ts --config=packages/PROJECT/jest.config.mjs

Run package tests:

    npx nx test twenty-front
    npx nx test twenty-server


## Build the Twenty MCP

    cd /Users/kasraaliyon/Documents/GitHub/twenty
    npx nx lint twenty-mcp
    npx nx typecheck twenty-mcp
    npx nx test twenty-mcp
    npx nx build twenty-mcp
    cd packages/twenty-mcp
    yarn mcpb:pack

Output:

    packages/twenty-mcp/twenty-mcp-server.mcpb


## Build the LinkedIn extension

    cd /Users/kasraaliyon/Documents/GitHub/twenty/twenty-crm-extension-main
    npm install
    npm run compile
    npm run build
    npm run build:firefox
    npm run zip
    npm run zip:firefox

Outputs are in:

    twenty-crm-extension-main/.output/


## First-time setup

    cd /Users/kasraaliyon/Documents/GitHub/twenty
    corepack enable
    yarn install
    brew install cloudflared


## Stop or reset

Stop the application and Cloudflare tunnel:

    Press Control-C in the launcher Terminal.

Stop PostgreSQL and Redis:

    bash packages/twenty-utils/setup-dev-env.sh --docker --down

Delete the local Docker database and start fresh:

    bash packages/twenty-utils/setup-dev-env.sh --docker --reset

Warning: `--reset` deletes local development data.


## Launcher summary

`Twenty CRM.app` opens Docker Desktop, starts PostgreSQL and Redis, prepares the
database, then runs the frontend, backend, worker, and restricted Apollo
Cloudflare tunnel.

Docker runs PostgreSQL and Redis. `yarn start` runs the application processes
and Cloudflare tunnel. The tunnel publicly forwards only:

    POST /webhooks/apollo/enrichment/:token
