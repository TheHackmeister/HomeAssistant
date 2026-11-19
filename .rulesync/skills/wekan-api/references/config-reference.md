# WeKan Server Configuration Reference

Server-side environment variables and setup steps that affect the REST API. Use this when standing up a test instance, debugging server-side errors, or advising a self-hoster on API-critical settings.

## Table of contents

1. [Local test instance (Docker Compose)](#local-test-instance-docker-compose)
2. [Snap install](#snap-install)
3. [Env vars critical to the API](#env-vars-critical-to-the-api)
4. [Env vars for auth / tokens](#env-vars-for-auth--tokens)
5. [Env vars for CORS](#env-vars-for-cors)
6. [Env vars for attachments](#env-vars-for-attachments)
7. [Env vars for webhooks](#env-vars-for-webhooks)
8. [Env vars for email](#env-vars-for-email)
9. [First-run and admin bootstrap](#first-run-and-admin-bootstrap)
10. [Version pinning and upgrades](#version-pinning-and-upgrades)

## Local test instance (Docker Compose)

Minimal `docker-compose.yml` for API testing. Adjust the version tag to match what you're targeting.

```yaml
services:
  wekandb:
    image: mongo:7
    container_name: wekan-db
    restart: unless-stopped
    command: mongod --logpath /dev/null --oplogSize 128 --quiet
    networks: [wekan-tier]
    expose: ["27017"]
    volumes:
      - wekan-db:/data/db
      - wekan-db-dump:/dump

  wekan:
    image: ghcr.io/wekan/wekan:latest  # PIN to a specific tag in real use
    container_name: wekan-app
    restart: unless-stopped
    networks: [wekan-tier]
    depends_on: [wekandb]
    ports:
      - "8080:8080"
    environment:
      - WRITABLE_PATH=/data
      - MONGO_URL=mongodb://wekandb:27017/wekan
      - ROOT_URL=http://localhost:8080
      - WITH_API=true
      - CORS=*
      - CORS_ALLOW_HEADERS=Authorization,Content-Type
    volumes:
      - wekan-files:/data:rw

volumes:
  wekan-db:
  wekan-db-dump:
  wekan-files:

networks:
  wekan-tier:
    driver: bridge
```

Start with `docker compose up -d`. Visit `http://localhost:8080`, register the first user (who becomes the global admin), and you're ready to hit the API at that base URL.

Alternative images: `quay.io/wekan/wekan`, `wekanteam/wekan`.

## Snap install

```
sudo snap install wekan
sudo snap set wekan root-url=https://boards.example.com
sudo snap set wekan mail-url=smtp://user:pass@smtp.example.com:587/
sudo snap set wekan with-api=true
wekan.help
```

Every env var below has a Snap equivalent: replace underscores with dashes and lower-case.

## Env vars critical to the API

| Variable | Purpose |
|---|---|
| `WITH_API=true` | **Required.** Without this, every REST endpoint returns an auth error even with a valid token. |
| `ROOT_URL` | Absolute URL of the WeKan site. Attachments, invitations, and password-reset links use this. Must match the URL clients hit. |
| `MONGO_URL` | Mongo connection string. WeKan supports MongoDB 5/6/7. |
| `PORT` | Container/service port. Docker default is `8080`; dev server is `3000`. |
| `WRITABLE_PATH` | Path where filesystem-backed attachments live. |
| `DEFAULT_BOARD_ID` | Board a fresh user lands on. |

## Env vars for auth / tokens

| Variable | Purpose |
|---|---|
| `ACCOUNTS_COMMON_LOGIN_EXPIRATION_IN_DAYS` | Bearer token lifetime. Default 90. Set to `null`/`0` for never-expiring. Maps to Meteor's `loginExpirationInDays`. |
| `ACCOUNTS_LOCKOUT_KNOWN_USERS_FAILURES_BEFORE` | Failed login attempts before a known user is locked out. |
| `ACCOUNTS_LOCKOUT_KNOWN_USERS_PERIOD` / `ACCOUNTS_LOCKOUT_KNOWN_USERS_FAILURE_WINDOW` | Lockout duration and detection window. |
| `LDAP_ENABLE`, `OAUTH2_ENABLED`, `OIDC_*` | Enable SSO. **Note**: REST `/users/login` only works for password accounts. SSO users can't get a bearer token that way — provision a dedicated password service account for API use. |

**Non-obvious behavior**: logging in a second time does **not** invalidate the previous token (issue #1437). Old tokens continue to work until they expire (or forever if expiration is disabled). To force logout, disable then re-enable the user via `PUT /api/users/:id`, or reset their tokens directly in Mongo.

## Env vars for CORS

Set these if your API client runs in a browser on a different origin than WeKan.

| Variable | Typical value | Purpose |
|---|---|---|
| `CORS` | `*` or `https://myapp.example.com` | Allowed origin(s). |
| `CORS_ALLOW_HEADERS` | `Authorization,Content-Type` | **Required** for cross-origin API calls; without this, browsers strip the `Authorization` header. |
| `CORS_EXPOSE_HEADERS` | as needed | Headers your client JS can read. |
| `BROWSER_POLICY_ENABLED` | `true`/`false` | Content-security-policy toggle. Disable if embedding WeKan in an iframe. |
| `TRUSTED_URL` | your app URL | Allowed iframe embedder. |

## Env vars for attachments

| Variable | Purpose |
|---|---|
| `WRITABLE_PATH` | Filesystem storage root. Container default `/data`. |
| `ATTACHMENTS_UPLOAD_MAX_SIZE` | Max bytes per upload. Example: `5000000`. |
| `ATTACHMENTS_UPLOAD_MIME_TYPES` | Comma-separated allow-list, e.g. `image/*,text/*,application/pdf`. |
| `ATTACHMENTS_UPLOAD_EXTERNAL_PROGRAM` | Optional AV scan hook, e.g. `avscan {file}`. WeKan invokes it before storing. |
| `AVATARS_UPLOAD_MAX_SIZE` / `AVATARS_UPLOAD_MIME_TYPES` / `AVATARS_UPLOAD_EXTERNAL_PROGRAM` | Same, for user avatars. |

Storage backends: filesystem (via `WRITABLE_PATH`), MongoDB GridFS (legacy default), and S3/MinIO/cloud via Rclone (see wiki "Rclone: Store attachments to cloud storage"). The `uploadattachment` command in `api.py` takes an optional storage-backend argument (`fs`, `gridfs`, `s3`).

## Env vars for webhooks

| Variable | Purpose |
|---|---|
| `Global_Webhook_URL` | Fires all activities to one URL, in addition to any per-board integrations. |
| `CARD_OPENED_WEBHOOK_ENABLED` | Include card-open events (off by default; can be noisy). |
| `WEBHOOKS_ATTRIBUTES` | Restrict or expand the fields sent in payloads. Example: `cardId,listId,oldListId,boardId,comment,user,card,commentId`. |

## Env vars for email

Only relevant to the API when your flow depends on user invites, password resets, or notifications.

| Variable | Purpose |
|---|---|
| `MAIL_URL` | SMTP URL, e.g. `smtp://user:pass@smtp.example.com:587/`. |
| `MAIL_FROM` | From address, e.g. `WeKan <boards@example.com>`. |

## First-run and admin bootstrap

- **The first user to register becomes the global admin.** If you're spinning up a test instance from scratch, register your intended admin *first*.
- To restore admin on an existing instance, set the user's `isAdmin: true` in Mongo directly, or use the CLI: `snap run wekan.help` for the Snap variant.
- The admin user is the only account that can hit `/api/users`, `/api/settings`, `/api/admin/attachment-settings`, and other global endpoints.

## Version pinning and upgrades

- **Pin the WeKan image tag.** `latest` is fine for a scratch dev instance, but never for anything a script depends on.
- **On upgrade**: re-verify your scripts against `api.py` and `models/*.js` at the new tag. WeKan changes endpoint shapes and adds fields regularly.
- **MongoDB migrations**: WeKan has moved through Mongo 3.x → 4.x → 5 → 6 → 7. When restoring dumps across major versions, use `mongorestore --noIndexRestore` to sidestep incompatible indexes.
- **FerretDB migration is in progress.** Some future WeKan versions run on FerretDB (SQLite/PostgreSQL backend). API behavior should be unchanged, but expect subtle differences under heavy load.
- **Security releases**: track the GitHub Security tab. Recent example: v9.89 fixed the "SortBleed" broken-access-control issue (GHSA-xm8x-c8wg-jhmf).
