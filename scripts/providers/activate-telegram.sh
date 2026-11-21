#!/usr/bin/env bash
# Run only after the exact implementation/image has passed both reviews.
set -euo pipefail
release=$1 image=$2 expected=$3 manifest=$4
[[ "$release" =~ ^/home/ubuntu/\.local/share/judoju-collector/telegram-[a-f0-9]{8}\.[A-Za-z0-9]+$ ]]
[[ "$image" =~ ^judoju-news-html-collector:telegram-[a-f0-9]{8}$ ]]
[[ "$expected" =~ ^sha256:[a-f0-9]{64}$ && "$manifest" =~ ^[a-f0-9]{64}$ ]]
base=/home/ubuntu/.local/share/judoju-collector/release/workers/collectors/compose.yaml
oldOverride=/home/ubuntu/.local/share/judoju-collector/hanwha-10b93aea.PO36emcz/compose.hanwha.yaml
prod=judoju-news-html-collector-collector-1
old=sha256:a01f01403f4849f8f7986606e201a7d77696225b4146d1f5b3b9e38dbe94649d
volume=judoju-news-html-collector_candidates
docker() { sudo -n docker "$@"; }
mounted() { docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}' "$prod"; }
test "$(docker inspect --format '{{.Image}}' "$prod")" = "$old"
test "$(docker image inspect --format '{{.Id}}' "$image")" = "$expected"
test "$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$prod")" = "$base,$oldOverride"
test "$(mounted)" = "$volume"
umask 077
# Allow only no store or an empty store from a verified prior rollback; preserve rate-limit state.
docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges:true -v "$volume":/data "$image" \
  node --input-type=module -e 'import{assertTelegramPreflight}from"./scripts/providers/telegram-release-check.mjs";assertTelegramPreflight("/data/telegram-links.sqlite","/data/telegram-rollback.json",process.argv[1]);' "$old"
snapshot="collection-before-telegram-$(date +%s%N).sqlite"
docker exec "$prod" node --input-type=module -e 'import assert from"node:assert/strict";import{existsSync}from"node:fs";import{DatabaseSync,backup}from"node:sqlite";const path="/data/"+process.argv[1];assert(!existsSync(path));const db=new DatabaseSync("/data/collection.sqlite",{readOnly:true});await backup(db,path);db.close();const snap=new DatabaseSync(path,{readOnly:true});assert.equal(snap.prepare("PRAGMA quick_check").get().quick_check,"ok");console.log(snap.prepare("SELECT count(*) n FROM candidates").get().n);snap.close();' "$snapshot" > "$release/count-before.txt"
docker cp "$prod":/data/"$snapshot" "$release/$snapshot"
sha256sum "$release/$snapshot" > "$release/backup.sha256"
override="$release/compose.telegram.yaml"
printf 'services:\n  collector:\n    image: %s\n    environment:\n      JUDOJU_TELEGRAM_LINKS: "1"\n' "$image" > "$override"
docker compose -p judoju-news-html-collector -f "$base" -f "$oldOverride" -f "$override" config --quiet
rollback() {
  rc=$?
  if [ "$rc" -ne 0 ]; then
    docker compose -p judoju-news-html-collector -f "$base" -f "$oldOverride" -f "$override" stop collector
    # The prior binary cannot expire Telegram URLs. Clear them before returning to it.
    docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges:true \
      -v "$volume":/data "$image" node --input-type=module -e 'import{existsSync}from"node:fs";import{openTelegramPageStore}from"./scripts/providers/telegram-link-worker.mjs";const file="/data/telegram-links.sqlite";if(existsSync(file)){const db=openTelegramPageStore(file);db.exec("DELETE FROM telegram_page_links; PRAGMA wal_checkpoint(TRUNCATE);");db.close();}'
    docker compose -p judoju-news-html-collector -f "$base" -f "$oldOverride" up -d --no-build --pull never collector
    docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges:true -v "$volume":/data "$image" \
      node --input-type=module -e 'import{writeFileSync}from"node:fs";writeFileSync("/data/telegram-rollback.json",JSON.stringify({status:"ROLLED_BACK_EMPTY",oldImage:process.argv[1],manifest:process.argv[2]}),{mode:0o600});' "$old" "$manifest"
  fi
  exit "$rc"
}
trap rollback EXIT
docker compose -p judoju-news-html-collector -f "$base" -f "$oldOverride" -f "$override" up -d --no-build --pull never collector
test "$(docker inspect --format '{{.Image}}' "$prod")" = "$expected"
test "$(mounted)" = "$volume"
finishVerification() {
  # Both READY and PENDING must prove startup, scope and web preservation first.
  startedAt="$(docker inspect --format '{{.State.StartedAt}}' "$prod")"
  docker logs --timestamps --since "$startedAt" "$prod" > "$release/current-container.log" 2>&1
  cat "$release/current-container.log" | docker exec -i "$prod" node --input-type=module -e 'import assert from"node:assert/strict";import{readFileSync}from"node:fs";import{DatabaseSync}from"node:sqlite";import{telegramPageCandidates}from"./scripts/providers/telegram-link-worker.mjs";import{assertWebPreserved,assertTelegramStarted,assertCurrentTelegramCycle,telegramActivationEvidence}from"./scripts/providers/telegram-release-check.mjs";const r=JSON.parse(readFileSync("./data/providers/routes.json"));const p=JSON.parse(readFileSync("./data/providers/permission-profiles.json")).profiles;assert.equal(telegramPageCandidates({...r,profiles:p},Date.now()).size,47);assert.equal(r.endpoints.filter(e=>e.metadata_collection).length,37);assert.equal(r.endpoints.filter(e=>e.status==="DISABLED").length,20);const db=new DatabaseSync("/data/collection.sqlite",{readOnly:true});const count=db.prepare("SELECT count(*) n FROM candidates").get().n;const preserved=assertWebPreserved(db,"/data/"+process.argv[1],Date.now());assert.equal(db.prepare("PRAGMA quick_check").get().quick_check,"ok");db.close();assertTelegramStarted("/data/telegram-links.sqlite");assertCurrentTelegramCycle(readFileSync(0,"utf8"),Date.parse(process.argv[2]));const evidence=telegramActivationEvidence("/data/telegram-links.sqlite",Date.now());console.log(JSON.stringify({...evidence,enabled:47,held:6,webRecords:count,preservedUnexpiredWeb:preserved,webPreserved:true}));' "$snapshot" "$startedAt" | tee "$release/live-verification.json"
  state="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["status"])' "$release/live-verification.json")"
  if [ "$state" = READY ]; then
    printf 'status=READY\nactivated_at=%s\nmanifest_sha256=%s\nimage=%s\n' "$(date -u +%FT%TZ)" "$manifest" "$expected" > "$release/activation.txt"
  else
    printf 'status=VERIFICATION_PENDING\nmanifest_sha256=%s\nimage=%s\n' "$manifest" "$expected" > "$release/activation.txt"
  fi
  trap - EXIT
  exit 0
}
for attempt in $(seq 1 120); do
  if [ "$(docker inspect --format '{{.State.Health.Status}}' "$prod")" = healthy ]; then
    saved="$(docker exec "$prod" node --input-type=module -e 'import{savedTelegramCount}from"./scripts/providers/telegram-release-check.mjs";console.log(savedTelegramCount("/data/telegram-links.sqlite"));')"
    if [ "$saved" -gt 0 ]; then
      finishVerification
    fi
  fi
  sleep 5
done
# A healthy worker awaiting its first sweep, a persisted host wait or an eligible
# link is pending evidence, not a failed deployment. Never call this READY.
if [ "$(docker inspect --format '{{.State.Health.Status}}' "$prod")" = healthy ]; then
  finishVerification
fi
exit 5
