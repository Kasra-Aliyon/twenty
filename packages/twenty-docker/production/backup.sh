#!/usr/bin/env bash
# Install root-owned at /opt/twenty/backup.sh; run through a restricted SSH command.
set -euo pipefail
umask 077
mode="${1:-backup}"
[[ "$mode" == backup || "$mode" == prepare ]] || { echo 'Use backup or prepare' >&2; exit 1; }
[[ "$EUID" == 0 ]] || { echo 'Run as root' >&2; exit 1; }
exec 9>/run/lock/twenty-backup.lock
flock -n 9 || { echo 'Another backup/deploy is running' >&2; exit 1; }

container() {
  local matches
  matches=$(docker ps -aq --filter label=com.twenty.deployment=production --filter "label=com.twenty.role=$1")
  [[ -n "$matches" && "$matches" != *$'\n'* ]] || { echo "Expected exactly one $1 container" >&2; return 1; }
  printf '%s' "$matches"
}

database=$(container db)
redis=$(container redis)
server=$(container server)
worker=$(container worker)
mcps=()
while IFS= read -r mcp; do
  [[ -z "$mcp" ]] || mcps+=("$mcp")
done < <(docker ps -aq --filter label=com.twenty.deployment=production --filter label=com.twenty.role=mcp)
[[ "${#mcps[@]}" -gt 0 ]] || { echo 'Expected at least one MCP container' >&2; exit 1; }
directory="/var/backups/twenty/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$directory"

resume=true
cleanup() {
  if [[ "$resume" == true ]]; then
    docker start "$server" >/dev/null
    for attempt in $(seq 1 120); do
      if [[ "$(docker inspect --format '{{.State.Health.Status}}' "$server")" == healthy ]]; then
        docker start "$worker" "${mcps[@]}" >/dev/null
        return
      fi
      sleep 5
    done
    echo 'CRM did not become healthy after backup; worker and MCP remain stopped.' >&2
    return 1
  fi
}
trap cleanup EXIT
# Stop writers before taking the matching database, uploads and queue snapshot.
docker stop --time 60 "$worker" "${mcps[@]}" "$server" >/dev/null
docker inspect "$database" "$redis" "$server" "$worker" "${mcps[@]}" > "$directory/containers.json"
docker exec "$database" pg_dump -U twenty -d default --format=custom --no-owner > "$directory/database.dump"
docker exec -i "$database" pg_restore --list < "$directory/database.dump" > "$directory/database.contents"
docker exec "$redis" redis-cli SAVE >/dev/null
docker cp "$redis:/data/dump.rdb" "$directory/redis.rdb"
docker cp "$server:/app/packages/twenty-server/.local-storage" "$directory/uploads"
for mcp in "${mcps[@]}"; do
  account=$(docker inspect --format '{{ index .Config.Labels "com.twenty.mcp-account" }}' "$mcp")
  case "$account" in
    kasra|''|'<no value>') session_directory="$directory/mcp-state" ;;
    *[!a-zA-Z0-9_-]*) echo 'Invalid MCP account label' >&2; exit 1 ;;
    *) session_directory="$directory/mcp-state-$account" ;;
  esac
  [[ ! -e "$session_directory" ]] || { echo 'Duplicate MCP account label' >&2; exit 1; }
  docker cp "$mcp:/state" "$session_directory"
done
test -s "$directory/database.dump"
touch "$directory/COMPLETE"
# Includes encryption keys in containers.json; this directory must remain root-only.
echo "Backup complete: $directory"
if [[ "$mode" == prepare ]]; then
  resume=false
  echo 'Writers stopped. The release pipeline must now deploy via Coolify.'
fi
