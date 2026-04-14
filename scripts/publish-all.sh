#!/usr/bin/env bash
set -euo pipefail

BASEDIR="$(cd "$(dirname "$0")/.." && pwd)"

# Publish order: core first (no deps), then packages that depend on core,
# then packages that depend on those, then CLI last (depends on everything).
PACKAGES=(
  core
  openapi
  asyncapi
  gherkin
  test-runner
  drizzle
  tanstack-query
  fastify
  express
  hono
  lambda
  jwt
  otel
  metrics
  logging
  security-headers
  solid-query
  vue-query
  svelte-query
  channel-client
  forms
  cli
)

FAILED=()
PUBLISHED=()

for pkg in "${PACKAGES[@]}"; do
  echo ""
  LOCAL_VERSION=$(node -p "require('$BASEDIR/packages/$pkg/package.json').version")
  REMOTE_VERSION=$(npm view "@triadjs/$pkg" version 2>/dev/null || echo "")

  if [ "$LOCAL_VERSION" = "$REMOTE_VERSION" ]; then
    echo "=== Skipping @triadjs/$pkg@$LOCAL_VERSION (already published) ==="
    PUBLISHED+=("$pkg")
    continue
  fi

  echo "=== Publishing @triadjs/$pkg@$LOCAL_VERSION ==="
  if npm publish --access public "$BASEDIR/packages/$pkg"; then
    PUBLISHED+=("$pkg")
    echo "Published @triadjs/$pkg@$LOCAL_VERSION"
  else
    FAILED+=("$pkg")
    echo "FAILED @triadjs/$pkg"
  fi
done

echo ""
echo "=== Results ==="
echo "Published: ${#PUBLISHED[@]}"
for p in "${PUBLISHED[@]}"; do echo "  @triadjs/$p"; done

if [ ${#FAILED[@]} -gt 0 ]; then
  echo ""
  echo "Failed: ${#FAILED[@]}"
  for p in "${FAILED[@]}"; do echo "  @triadjs/$p"; done
  exit 1
fi

echo ""
echo "All packages published successfully!"
