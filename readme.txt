bash packages/twenty-utils/setup-dev-env.sh
yarn start

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
