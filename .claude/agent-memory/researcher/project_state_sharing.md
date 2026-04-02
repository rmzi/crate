---
name: state-sharing feature context
description: Goal and codebase context for the state-sharing feature branch — syncing favorites/heard state across devices via username/password encrypted cloud backend
type: project
---

State-sharing feature goal: sync user state (favorites, heard tracks) across devices using a username/password that encrypts data stored in a cloud backend. Work is on the `state-sharing` branch.

**Why:** Currently all state is device-local (localStorage + IndexedDB). Users lose state when switching devices or browsers.

**How to apply:** Any new backend must integrate with the existing `storage.js` load/save pattern. The sync model should be additive — localStorage remains the source of truth locally, cloud is the sync layer.

Key state to sync:
- `state.favoriteTracks` (Set of track IDs) — stored in localStorage under `${prefix}_favorite_tracks`
- `state.heardTracks` (Set of track IDs) — stored in localStorage under `${prefix}_heard_tracks`
- `state.secretUnlocked` (boolean) — stored under `${prefix}_secret_unlocked`

Existing AWS infra: S3 + CloudFront + Route53 + Secrets Manager, managed by Terraform in `/terraform/`. No existing Lambda, API Gateway, Cognito, or DynamoDB. Auth today is CloudFront signed cookies (not user-level auth).
