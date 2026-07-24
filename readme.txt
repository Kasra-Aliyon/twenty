# running the app:
bash packages/twenty-utils/setup-dev-env.sh
yarn start

# building the mcp upon changes:

npx nx lint twenty-mcp
npx nx typecheck twenty-mcp
npx nx test twenty-mcp
npx nx build twenty-mcp

cd packages/twenty-mcp
yarn mcpb:pack

# Building the linkedin connector:

cd twenty-crm-extension-main

npm run compile
npm run build
npm run build:firefox
npm run zip
npm run zip:firefox

bash packages/twenty-utils/setup-dev-env.sh
yarn start:localhost

"
setup-dev-env.sh is the repo’s one-shot local setup script. It starts Postgres and Redis, creates/copies needed env files, and initializes the database schema. It is idempotent, so it’s safe to run again if you’re unsure whether your local services are ready.
Then yarn start starts the main local dev environment: frontend, backend, and worker.

"

Useful variants:


bash packages/twenty-utils/setup-dev-env.sh --reset
Wipes local dev data and starts fresh.


bash packages/twenty-utils/setup-dev-env.sh --docker
Forces Docker-based Postgres/Redis.


npx nx start twenty-front
npx nx start twenty-server
npx nx run twenty-server:worker

Runs frontend, backend, or worker individually.
