#!/usr/bin/env bash
# Verify the v0.1.0-poc release (issue #15): tag exists, is annotated, points
# to a commit reachable from origin/main, and the published release has notes
# and at least one asset. Exits non-zero with a clear message on any failure.
set -euo pipefail

TAG="${1:-v0.1.0-poc}"

fail() { echo "RELEASE VERIFY FAIL: $*" >&2; exit 1; }

# Tag must exist locally after fetch and be annotated (type tag, not commit).
git fetch origin "refs/tags/${TAG}:refs/tags/${TAG}" 2>/dev/null || fail "tag '${TAG}' not found on origin"
obj_type="$(git cat-file -t "${TAG}" 2>/dev/null || echo missing)"
[ "$obj_type" = "tag" ] || fail "tag '${TAG}' is not annotated (cat-file type: ${obj_type})"

# Tag target must equal the current origin/main HEAD (release pins the verified main commit).
tagged_commit="$(git rev-parse "${TAG}^{commit}")"
main_commit="$(git rev-parse origin/main)"
[ "$tagged_commit" = "$main_commit" ] || fail "tag '${TAG}' points at ${tagged_commit}, but origin/main is ${main_commit}"

# Published release must have notes and >= 1 asset.
gh release view "$TAG" --json body,assets,isDraft --jq '
  if .isDraft then "draft" else "published" end,
  (.body | length),
  (.assets | length)
' | {
  read -r state; read -r body_len; read -r asset_count
  [ "$state" = "published" ] || fail "release '${TAG}' is not published (state: ${state})"
  [ "$body_len" -gt 200 ] || fail "release '${TAG}' has no meaningful notes (body length: ${body_len})"
  [ "$asset_count" -ge 1 ] || fail "release '${TAG}' has no assets (expected the demo cast and/or MP4)"
}

echo "RELEASE VERIFY OK: ${TAG} annotated at ${tagged_commit} (= origin/main), published with notes and assets."
