#!/bin/bash
# Cloud sessions: start the Docker daemon and load the pinned Postgres image the
# P4 integration tests require (scripts/test-main-p4-integration.mjs pins the image ID).
# public.ecr.aws hits a data limit through the session proxy; the Docker Hub copy has
# the identical image ID, which the tests verify, so it is re-tagged under the ECR name.
set -euo pipefail
if ! docker info >/dev/null 2>&1; then
  (dockerd >/tmp/dockerd.log 2>&1 &)
  for _ in $(seq 1 30); do docker info >/dev/null 2>&1 && break; sleep 1; done
fi
want=sha256:7c31363a3f7434ff14945f1b8a4880e6eca8b362e197e88b87c476c77aa3cf8c
tag=public.ecr.aws/supabase/postgres:17.11.0.018
if [ "$(docker image inspect "$tag" --format '{{.Id}}' 2>/dev/null)" != "$want" ]; then
  docker pull -q supabase/postgres:17.11.0.018 >/dev/null
  test "$(docker image inspect supabase/postgres:17.11.0.018 --format '{{.Id}}')" = "$want"
  docker tag supabase/postgres:17.11.0.018 "$tag"
fi
echo "docker ready; $tag = $want"
