# Deploy Chronica to Azure on an Azure for Students subscription

## Context

The owner is opening an **Azure for Students** subscription for its free credit. The repo has no
deployment setup: no Dockerfile, no infra, no CI.

Decisions already made with the owner:
- Azure Container Apps, with Bicep and GitHub Actions.
- The default Container Apps hostname for now.
- **No Resend.** Production sends no email.
- **AI stays on the owner's OpenAI account.**
- Images go to a **Docker Hub** private repository.
- The app **scales to zero** when idle.
- **Google sign-in is skipped** for now.
- The owner commits the branch's uncommitted work before the first deploy.

**Outcome:** a merge to `main` builds an image, migrates the database, and serves the game at
`https://ca-chronica-web.<env-domain>`. Hosting is paid by the Students credit, and the coin ledger
charges players correctly. Every later change has one documented command
(§Updating what's deployed).

## What the Students subscription changes (second review, 2026-09-26)

**1. The Students credit most likely can't pay for model tokens.**
- Microsoft answers on Q&A say Foundry itself is allowed on Azure for Students, but Azure OpenAI
  models are not ([1], [2]). Subscriptions report 0 quota for every model in every region.
  Where there is any quota, it is about 1K tokens per minute, and reasoning models are at 0.
- gpt-5-nano and gpt-6-luna are reasoning models. The orchestrator prompt alone is about 15K
  tokens, so even 8K tokens per minute can't fit a single call.
- **Plan:** hosting goes on Azure. Tokens stay on the owner's OpenAI account
  (`CHRONICA_AI_MODE=openai`, with the key kept in Key Vault).
- The Azure model target becomes **Phase 2**. It is built only when a subscription can actually
  deploy the models. Runbook step 1 settles this in five minutes: if the Students subscription
  shows quota after all, Phase 2 can start at once.

**2. $100 has to last twelve months, so hosting is resized to about $0 to $3 a month.**
- The first draft's platform cost about $43 a month idle, which would spend the whole credit in
  about ten weeks.
- The changes are in B1: scale to zero, the free Postgres tier, no paid container registry, and a
  capped Log Analytics workspace.

**3. Students-specific constraints.**
- **Regions.** Deployments are limited to about five regions picked per subscription, enforced
  by Azure Policy ([3]). A support ticket can't change the list. Find the list under Policy >
  Assignments > "Allowed resource deployment regions" and use a region from it; `swedencentral`
  is only a preference.
- **Directory.** A school sign-in puts the subscription in the university's Entra directory,
  which often forbids app registrations. GitHub deploys therefore use a **user-assigned managed
  identity with a federated credential**, which needs no app registration and no directory
  rights.
- **No overspending.** The subscription has a spending limit: when the credit runs out,
  resources are switched off rather than billed. A budget alert is optional, and off by default.
  Check the balance in the portal under Education or Sponsorships.
- **Expiry.** The subscription lasts twelve months, and is renewable while the owner is a student.
  Keep monthly `pg_dump` backups (`infra/scripts/backup-db.sh`), so an expiry or a switch to a
  paid plan loses nothing.
- **ACR Tasks.** These are blocked on credit-funded subscriptions. That no longer matters, because
  images are built in GitHub Actions.

**4. Without Resend, production can't send email.**
- Sign-up and sign-in use a username and password, and changing an email address skips
  verification, so both still work.
- Password reset and email verification do not. Worse, today the reset page still says "a reset
  link is on its way" when nothing will be sent.
- A8 hides the reset and verification entry points when no email transport is configured. A
  player who forgets their password asks the owner, who resets it by hand.

**5. Azure token prices are known.**
- They come from the public Retail Prices API; see §Model prices.
- Global Standard is **identical to OpenAI direct** for every model the code knows. Data Zone costs
  10 % more, and Priority processing costs twice as much.
- Azure also bills **cache writes** (1.25× input) for the gpt-6 and gpt-5.6 families. The
  adapter always reports `cacheWriteTokens: 0`, so check the usage object on the first live call.
  If OpenAI direct bills cache writes too, today's charges are slightly low.

Everything from the first review still stands:
- The build passes with no env files, and every route is dynamic.
- The standalone server boots, reports healthy, and drains on SIGTERM.
- The journal entries are in (`32c1974`).
- Pools are per request (A6).
- `main` is 68 commits behind `player-as-a-character`.
- The Mac has no `az` or `docker`.

## Verified facts the plan rests on

- **Adapter.** One OpenAI client is built at `openai-local.ts:195` from `OPENAI_API_KEY`.
  `callWithTools` uses the Responses API; `call` uses streamed chat completions. In production
  (`NODE_ENV=production`) the local model selection is ignored, and the tier table applies:
  `gpt-5-nano`, `gpt-6-luna` and `gpt-6-sol`, set with `CHRONICA_AI_MODEL_BASIC/STANDARD/PREMIUM`.
- **Coin gate.** `coin-gate.ts` looks up `MODEL_TOKEN_RATES[result.model]` in two places, and an
  unknown name silently gets the `gpt-5.6-sol` rate. Hand mode (`adapter.free`) skips the gate.
- **Modes.** There are five AI modes: `openai`, `local`, `mock`, `hand`, and `azure` in Phase 2.
  `abortsTheTurn` is in `packages/shared/src/ai-timeout.ts`.
- **Bursts and shutdown.** The burst runs in the web process via `after()`
  (`simulation-service.ts:109`) and heartbeats (0039). On SIGTERM, Next 15.5 closes the server,
  drains pending `after()` work, then exits, unless `NEXT_MANUAL_SIG_HANDLE` is set. A burst
  killed anyway frees the game about 90 s later.
- **Requests.** The page polls `/api/games/[id]/bursts/[burstId]`. There is no SSE and no long
  request, so the 240 s ingress timeout doesn't matter.
- **Postgres.** No extensions are needed. Advisory transaction locks and `SET LOCAL` need a direct
  connection (no PgBouncer). The built-in scenario is installed at runtime, so a fresh database
  needs no seed.
- **Migrations.** `drizzle-kit` is a runtime dependency of `@chronica/db`. `drizzle.config.ts`
  reads `DATABASE_URL`. The migrator applies only entries newer than the newest recorded one, so
  an older checkout is a no-op against a newer database.
- **Auth.** Production requires `BETTER_AUTH_SECRET` (at least 32 characters). `BETTER_AUTH_URL`
  is the only trusted origin. Email is used only by `sendResetPassword` and
  `sendVerificationEmail` (`authentication.ts:71`, `:75`), and in production `sendAuthEmail`
  throws when Resend isn't configured.
- **CI.** Unit tests never touch Postgres, so CI needs no database. The repo (`Zemodeler/Chronica`)
  is private, with 2 000 free Actions minutes a month; a deploy costs about 6 to 8.

## Part A. Repository code (Phase 1)

### A2. Provider on results, and billing stops guessing

- **`adapter.ts`.** Add `AiProvider = "openai" | "azure" | "anthropic" | "mock" | "hand"`, and
  `provider` on `AiCallResult`. Set it in all four constructors: openai-local, anthropic-local,
  mock and hand.
- **New `packages/ai/src/model-rates.ts`,** moved out of the coin gate.
  - `MODEL_TOKEN_RATES` is keyed by provider, then model.
  - `openai` keeps its five entries.
  - `azure` is filled from §Model prices now, not left as placeholders. That is Global Standard,
    with cache-write rates.
  - `anthropic` stays a `TODO(pricing)`.
  - `mock` and `hand` are zero. `HOLD_RATE` moves here too.
- **`rateFor(result)`.** For an unknown model it throws `UnknownModelRateError` in production;
  elsewhere it logs and returns `HOLD_RATE`.
- **`coin-gate.ts`.** Both lookups use `rateFor`. On a throw, release the hold, then rethrow.
- **`dev-cost.ts`** prints `provider:model`.
- **`packages/shared/src/ai-timeout.ts`.** `abortsTheTurn` recognises `UnknownModelRateError` by
  name. Add `ai-timeout.test.ts`.

### A3. Env documentation

`.env.example`, AI section:
- Document `CHRONICA_AI_MODE` with its values.
- Add `CHRONICA_DB_POOL_MAX`.
- Delete the nineteen variables nothing reads:
  - the eleven from the first draft: `AZURE_AI_DEPLOYMENT`, `LOCAL_AI_BASE_URL`,
    `LOCAL_AI_MODEL`, `CHRONICA_AI_PROVIDER`, `CHRONICA_AI_ENABLED`, `CHRONICA_DEV_CLI_AI`,
    `CHRONICA_CODEX_CLI_PATH`, `CHRONICA_ACTIVE_AI_PROFILE_VERSION`,
    `CHRONICA_DISABLE_DEFINED_ACTIONS`, `CHRONICA_SESSION_SECRET`,
    `CHRONICA_DEFAULT_MATCH_CAP_MICROCREDITS`;
  - the eight `PADDLE_*` variables.

Resend stays documented as optional.

### A4. Migration journal test

New `packages/db/src/migrations-journal.test.ts`:
- every `.sql` file is a journal tag, and every tag has a file;
- `idx` is contiguous;
- `when` is strictly increasing.

The entries themselves are already in (`32c1974`).

### A5. Build artefacts

**One image.** Migrations run from the pipeline (B3), so there is no migrator target.

**Dockerfile** at the repo root, `node:22-bookworm-slim`:

| Stage | Contents |
|---|---|
| `deps` | Root and workspace `package.json` files plus the lockfile; `npm install -g npm@11`; `npm ci` |
| `build` | `COPY . .`, `NEXT_TELEMETRY_DISABLED=1`, `npm run build -w @chronica/web` |
| `runner` | Copies `.next/standalone`, `.next/static` into `apps/web/.next/static`, and `apps/web/public`; `USER node`; `WORKDIR /app/apps/web`; `ENV PORT=3000 HOSTNAME=0.0.0.0 NODE_ENV=production`; `CMD ["node","server.js"]` |

Never set `NEXT_MANUAL_SIG_HANDLE`.

**`.dockerignore`:** `node_modules`, `.next`, `dist`, `.git`, `.env*` except `.env.example`,
`eval-out`, `docs`, `shots`, `test-results`, `apps/web/public/maps/*.orig`, `.claude`,
`.chronica.local-ai.json`.

### A6. One database pool per process

- `createDatabase(url)` returns the process-wide client, and its `close()` becomes a no-op.
- In the same change, rename the call sites to `getDatabase()` and delete the `close()` calls and
  `getSharedDatabase`, per the "rewrite legacy, don't shim it" rule.
- The burst keeps its own client (`createBurstDatabase()`, which really closes) so a long burst
  can't starve page requests.
- `/api/health` uses the shared client.

**Result:** at most `CHRONICA_DB_POOL_MAX` connections for pages plus the same for one burst. At 8,
that is 16 per replica and at most 32 during a revision switch, under B1ms's roughly 35 user
connections (50 minus 15 reserved).

### A7. Docs

Add a "Deployment" heading to `docs/architecture.md` covering:
- the provider modes;
- the env list the container needs;
- one pool per process;
- scale to zero, and bursts drained on SIGTERM.

It links to `infra/README.md`.

### A8. No email transport means no email features

- `sendAuthEmail`'s transport check moves into one exported `emailConfigured()` helper.
- When it returns false, the login page hides "Forgot password?" and `/forgot-password` says:
  "Password reset isn't available on this server. Ask the owner."
- The account screen doesn't offer email verification.
- In development the console transport still counts as configured.

## Part B. Azure infrastructure (`infra/`) and CI (`.github/workflows/`)

### B1. Resources, sized for $100 a year

Everything is in `rg-chronica-prod`, in **one region from the subscription's allowed list**
(`location` param).

| Resource | Name | Key properties | Cost on Students |
|---|---|---|---|
| Log Analytics | `log-chronica-prod` | 30-day retention, **0.15 GB daily cap** | $0 (under the 5 GB a month free) |
| User-assigned identity (app) | `id-chronica-web` | Key Vault Secrets User | $0 |
| User-assigned identity (deploy) | `id-chronica-deploy` | Federated credential for GitHub `main`; Contributor on the group; Key Vault Secrets User | $0 |
| Key Vault | `kv-chronica-<suffix>` | RBAC mode, template deployment enabled, purge protection off | cents |
| Postgres Flexible Server | `psql-chronica-<suffix>` | PG16, **Standard_B1ms, 32 GiB, autogrow off** (both inside the free tier); 7-day backup; public access with the Azure-services rule plus `ownerIp`; `require_secure_transport` on; admin `chronica_admin`; database `chronica` | **$0 for 12 months** (750 B1ms hours and 32 GB free; confirm in the Free services blade). Otherwise about $14.50 a month |
| Container Apps environment | `cae-chronica-prod` | **Consumption profile only.** A dedicated profile adds a $0.10 an hour management fee (about $73 a month) | $0 |
| Container App | `ca-chronica-web` | 1 vCPU / 2 GiB; **min 0 / max 1**; HTTP scale rule, **`cooldownPeriod: 900`**; single revision mode; external HTTPS ingress on 3000, `allowInsecure: false`; registry credential from Key Vault; startup + readiness HTTP `/api/health`, liveness TCP 3000; `terminationGracePeriodSeconds: 600`; revision suffix = short sha | $0 up to about 50 active hours a month (the free grant is 180 000 vCPU-s and 360 000 GiB-s); then about $0.11 per active hour; $0 while scaled to zero |
| Registry | Docker Hub, one private repository `<user>/chronica` | Tags `<sha>`. A read-only access token in Key Vault as `registry-password` | $0. Alternative: ACR Basic at about $5 a month ($60 of the $100); pulls with the identity, no token |
| Budget | optional, `deployBudget=false` by default | The spending limit already stops overspend | n/a |

**Scale to zero.**
- The first request after 15 idle minutes waits for a cold start: pulling the image and booting
  the server, estimated at about 10 to 30 seconds.
- The page polls while a turn runs, which keeps the replica alive.
- If the player closes the tab, the replica scales in 15 minutes after the last request, and the
  600 s grace period lets a running burst finish.
- If this is ever too slow, set min replicas to 1 at 0.5 vCPU / 1 GiB. That costs about $10 a
  month idle, too much for the Students credit.

**Why not GHCR:** GitHub's free plan allows only 1 GB a month of private-package transfer outside
Actions. With scale to zero, pulls could use that up in a handful of cold starts.

**Tokens** stay on the owner's OpenAI account, outside the Azure bill (Phase 1).

**Trade-offs accepted:**
- Public Postgres behind a firewall, because a VNet doubles the moving parts.
- No PgBouncer.
- The app connects as the admin role.
- Max one replica, because of burst affinity: a burst dies with the replica that accepted the
  order.

### B2. Bicep layout

```
infra/
  bootstrap.bicep    owner, once: log analytics, both identities, key vault, deploy federated credential
  main.bicep         owner, on platform change: postgres, cae, role assignments, optional budget
  web.bicep          pipeline, every deploy: the container app at the new image
  main.bicepparam    committed, non-secret platform values (location, ownerIp, sizes)
  web.bicepparam     committed, non-secret app config (models, timeouts, pool, cpu/memory, scale)
  modules/           log-analytics, identity, keyvault, postgres, container-app-env,
                     container-app, roles, budget
  scripts/           platform.sh, set-secret.sh, rotate-db-password.sh, backup-db.sh, logs.sh
  README.md          runbook, operations, updating
```

**`main.bicep`:**
- Feeds the Postgres password with `kv.getSecret('postgres-admin-password')`.
- Outputs `caeDefaultDomain` and `postgresHost`.

**`web.bicep`:**
- Params: `imageTag`, `image` (the repository), `dbPoolMax`, `googleClientId`,
  `aiModelBasic/Standard/Premium`, the AI timeouts, `cpu`, `memory`, `minReplicas`,
  `cooldownPeriod`.
- Computes `BETTER_AUTH_URL = https://ca-chronica-web.${cae.properties.defaultDomain}`.
- The Google secret ref is included only when `googleClientId != ''`.
- Every secret is a Key Vault `secretRef` read through `id-chronica-web`.

**Web app env:**

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `NEXT_TELEMETRY_DISABLED` | `1` |
| `DATABASE_URL` | secret |
| `CHRONICA_DB_POOL_MAX` | `8` |
| `BETTER_AUTH_SECRET` | secret |
| `BETTER_AUTH_URL`, `CHRONICA_PUBLIC_URL` | computed origin |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | optional |
| `CHRONICA_GIFT_CODE_PEPPER` | secret |
| `CHRONICA_AI_MODE` | `openai` |
| `OPENAI_API_KEY` | secret |
| `CHRONICA_AI_MODEL_BASIC/STANDARD/PREMIUM` | from `web.bicepparam` |
| `CHRONICA_AI_TIMEOUT_MS` | `30000` |
| `CHRONICA_AI_MAX_MS` | `150000` |
| `CHRONICA_AI_MAX_RETRIES` | `1` |

No `RESEND_API_KEY` and no `CHRONICA_EMAIL_FROM`.

### B3. Migrations run from the pipeline, behind a temporary firewall rule

This replaces the Container Apps Job and the migrator image from the first draft. It has the same
guarantees: one observable execution, a red step on failure, and a hard stop before the web app
changes. It needs one image fewer and one resource fewer.

The deploy job:
1. Reads `database-url` from Key Vault with `az keyvault secret show`.
2. Opens a firewall rule for the runner's own IP (`az postgres flexible-server firewall-rule
   create`).
3. Runs `npm run migrate -w @chronica/db`.
4. Removes the rule in an `always()` step, so a failure can't leave it open.

Drizzle records the entries it applied, so re-runs and rollbacks are no-ops. Every migration stays
idempotent and additive-first, because the old revision runs against the new schema until the web
deploy lands.

### B4. GitHub Actions

**`ci.yml`**, on pull requests and pushes to branches other than `main`: `setup-node` 22 with the
npm cache, `npm ci`, typecheck, lint, test, and `az bicep build` on the entry points.

**`deploy.yml`**, on push to `main` (ignoring `docs/**`) and on `workflow_dispatch` with an
optional `image_tag`. `permissions: id-token: write, contents: read`. `concurrency: deploy-prod`,
never cancelled. Steps:
1. `azure/login@v2` with `id-chronica-deploy`'s client id, plus the tenant and subscription ids
   (three repo secrets).
2. Build and push, skipped when `image_tag` is given: `docker/login-action` to Docker Hub
   (`DOCKERHUB_USERNAME` and a read-write `DOCKERHUB_TOKEN` as repo secrets), then
   `docker/build-push-action` with the GHA cache, tagged `<sha>`.
3. `npm ci`, then migrate (B3).
4. `az deployment group create -f infra/web.bicep -p infra/web.bicepparam imageTag=<tag>`.
5. Poll the newest revision until it is provisioned, then `curl -f --retry 6 .../api/health`,
   which also wakes a scaled-to-zero app. Write the URL, tag and revision to the step summary.

### B5. Secrets

Nobody types a secret into Azure by hand. There are two sources.

**Generated.** `infra/scripts/platform.sh` creates these in Key Vault as fresh random values if
they're missing, and never prints them:
- `postgres-admin-password`
- `database-url`, built from that password
  (`postgres://chronica_admin:<pw>@<postgresHost>:5432/chronica?sslmode=require`)
- `better-auth-secret`
- `gift-code-pepper`, generated once and never replaced

**Provided by the owner as GitHub secrets.** The deploy workflow copies these into Key Vault on
every run, masked in the logs:
- `OPENAI_API_KEY`, copied to `openai-api-key`;
- `DOCKERHUB_PULL_TOKEN` (read-only), copied to `registry-password`, for Container Apps' image
  pulls.

**GitHub only:**
- `DOCKERHUB_USERNAME`;
- `DOCKERHUB_TOKEN` (read-write, for the push);
- the three Azure ids (`AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`). These are
  identifiers, not credentials; setup sets them with `gh`.

Rotating the OpenAI key or a Docker token is `gh secret set <NAME>`, then `npm run azure:deploy`.

Google sign-in is skipped for now: no Google secret and no Google env.

Nothing sensitive goes in a `.bicepparam`.

### B6. Owner runbook, in order (goes in `infra/README.md`)

0. **Prerequisites.**
   - `brew install azure-cli`, then `az login`.
   - A Docker Hub account with one private repository.
   - Merge `player-as-a-character`, with its work committed, into `main`. Keep `deploy.yml` off
     `main` until step 6.
1. **Check what the subscription allows.**
   - Allowed regions: Policy > Assignments > "Allowed resource deployment regions".
   - Postgres free tier: Free services blade.
   - Model quota, to decide on Phase 2: `az cognitiveservices usage list -l <region> -o table`.
     Zero or about 1K tokens per minute means Phase 1 only.
2. **Bootstrap.** `az group create -l <allowed region>`, deploy `bootstrap.bicep`, and grant
   yourself Key Vault Secrets Officer.
3. **Seed the secrets** with `infra/scripts/set-secret.sh <name>` (it prompts, so nothing lands in
   shell history).
4. **Platform.** Fill `main.bicepparam` (`location`, `ownerIp`), then run
   `infra/scripts/platform.sh` (what-if, confirm, deploy).
5. **Check the custom setting on Flexible Server:**
   `BEGIN; SET LOCAL chronica.scenario_mutation_approved='yes'; SELECT current_setting('chronica.scenario_mutation_approved'); ROLLBACK;`
6. **GitHub.** `gh secret set` the five secrets. Fill `web.bicepparam`, then merge the infra and
   workflow PR into `main`, which runs the first deploy.
7. **Google (optional).** Add `https://ca-chronica-web.<domain>/api/auth/callback/google` as a
   redirect URI.
8. **Verify.**
   - `/api/health` reports healthy, including after a cold start.
   - Sign up with a username, start a game and play one turn. This spends OpenAI tokens.
   - Watch for `[AI] simulate_orchestrate | openai:gpt-6-luna` and the `[burst …]` lines.
   - Confirm the ledger shows the charge and no lingering hold.
   - Check the Students credit balance the next day.

### B7. Operations

- **Logs.** `infra/scripts/logs.sh` wraps `az containerapp logs show --follow`. Log Analytics has
  `ContainerAppConsoleLogs_CL` (filter on `[burst` or `[AI]`) and `ContainerAppSystemLogs_CL`.
- **Backups.** Run `infra/scripts/backup-db.sh` monthly. It adds a temporary firewall rule, runs
  `pg_dump`, and removes the rule; the dump lands in `~/chronica-backups`. Azure's own 7-day
  backups cover everything else.
- **Stale holds.** `burst-runner.ts` sweeps before each burst. If held coins ever linger, run
  `scripts/sweep-holds.mts` against prod.
- **Old images.** Delete Docker Hub tags older than the last ten now and then.

## Phase 2. Model tokens on Azure (only once a subscription has quota)

This starts only if runbook step 1 shows real quota: Students after all, or a later
Pay-As-You-Go or sponsored subscription. It was A1 and A3 in the first draft, unchanged:
- **`azure-client.ts`:** `AzureOpenAI` with `AZURE_AI_ENDPOINT` and `AZURE_AI_API_VERSION`
  (default `2025-04-01-preview`). Auth is `AZURE_AI_API_KEY` locally, or
  `getBearerTokenProvider(new DefaultAzureCredential(), "https://cognitiveservices.azure.com/.default")`
  with `AZURE_CLIENT_ID` in production. Add `@azure/identity`, and list it in
  `serverExternalPackages`.
- **`openai-local.ts`:** parameterised by `OpenAiTarget = "openai" | "azure"`; results carry
  `provider`; `resolveModel(operation, target)`.
- **Factory:** `case "azure"` in `index.ts`. The local selection is consulted only for `openai`
  and `local`.
- **Throttling:** `abortsTheTurn` treats a 429 matching `/retry after|rate limit/i` as transient,
  because Azure's throttling text contains "quota".
- **Infra:** an `aoai-chronica-prod` AIServices account in `main.bicep`, with deployments named
  exactly after the models, GlobalStandard, and `disableLocalAuth`. `id-chronica-web` gets
  Cognitive Services OpenAI User. `web.bicepparam` switches `CHRONICA_AI_MODE=azure` and adds
  `AZURE_AI_ENDPOINT` and `AZURE_CLIENT_ID`.
- **Fallback** if a resource rejects those paths: upgrade `openai` to a version whose `apiKey`
  takes a token function, and use `baseURL = ${endpoint}/openai/v1`.

## Model prices

From the Azure Retail Prices API ([4]), 2026-09-26, `swedencentral`, spot-checked against
several other regions (the same everywhere). All figures are USD per million tokens, Standard,
short context.

| Model | Deployment | Input | Cached input | Cache write | Output |
|---|---|---|---|---|---|
| `gpt-5-nano` | Global | 0.05 | 0.005 | none | 0.40 |
| `gpt-5-nano` | Data Zone | 0.055 | 0.0055 | none | 0.44 |
| `gpt-6-luna` | Global | 0.10 | 0.01 | 0.125 | 0.50 |
| `gpt-6-luna` | Data Zone | 0.12 | 0.012 | 0.15 | 0.60 |
| `gpt-6-sol` | Global | 2.00 | 0.20 | 2.50 | 10.00 |
| `gpt-6-sol` | Data Zone | 2.40 | 0.24 | 3.00 | 12.00 |
| `gpt-5.6-luna` | Global | 0.20 | 0.02 | 0.25 | 1.20 |
| `gpt-5.6-sol` | Global | 4.00 | 0.40 | 5.00 | 20.00 |

Notes:
- **Long context** has its own meters at about double, for example gpt-6-luna at 0.20 / 0.02 /
  0.25 / 0.75. The API doesn't state the threshold; Chronica's prompts are short.
- **Priority processing** is twice Standard; **Flex** and **Batch** are about half. Chronica uses
  none of them.
- **In coin units** (1 coin = $1 = 1 000 000 micro-units), gpt-6-luna Global Standard is
  `input 100_000n, cacheRead 10_000n, cacheWrite 125_000n, output 500_000n`, the same as today's
  `openai` entry plus a cache-write rate.
- **Hosting**, for reference: Container Apps is $0.000024 per active vCPU-second and $0.000003
  per GiB-second. B1ms is $0.0199 an hour. ACR Basic is $0.1666 a day.

## Updating what's deployed

Each kind of change has one path. The portal is read-only in practice, because the next deploy
overwrites anything changed there.

| To change… | Do this |
|---|---|
| Code, migrations, rates | Merge to `main`. The pipeline builds, migrates, deploys and health-checks. |
| Re-deploy without a change | `npm run azure:deploy` (`gh workflow run deploy.yml`) |
| Roll back | `npm run azure:rollback -- <sha>`. The image already exists, and migrations are a no-op. Migrations are never rolled back; write a compensating one. |
| App config (models, timeouts, pool, CPU and memory, min replicas, cooldown) | Edit `infra/web.bicepparam`, then merge |
| A secret (OpenAI key, auth secret, registry token) | `npm run azure:secret -- <name>`. It sets the Key Vault value and restarts the revision so it is picked up. |
| The database password | `infra/scripts/rotate-db-password.sh`. It updates the server and both secrets, then restarts. |
| Platform (Postgres, region, budget) | Edit `infra/main.bicepparam`, then `npm run azure:platform` (what-if, confirm, apply) |
| Switch tokens to Azure | Phase 2 above, then set `CHRONICA_AI_MODE=azure` in `web.bicepparam` |
| Logs and backups | `npm run azure:logs`, `npm run azure:backup` |

The root `package.json` gets these `azure:*` aliases as thin wrappers over `gh` and
`infra/scripts/`.

## Order of work

1. Land `player-as-a-character` on `main` (the owner decides when).
2. A4 journal test.
3. A2: provider on results, `model-rates.ts` with the Azure prices, the coin gate, `dev-cost`,
   and `abortsTheTurn`.
4. A6: one pool per process.
5. A8: hide email features without a transport.
6. A3 and A7: `.env.example` and docs.
7. A5: the Dockerfile and `.dockerignore`.
8. `infra/`: Bicep, params, scripts, the runbook, and the npm aliases.
9. `.github/workflows/`.
10. Phase 2, only if quota exists.

## Verification

- **Checks.** `npm run typecheck`, `npm run lint` and `npm test`. The new tests cover
  model-rates, `ai-timeout`, the journal, the single pool, and `emailConfigured`.
- **Clean build.** `npm run build -w @chronica/web` in a copy with no env files (this passes
  today).
- **Local image (needs Docker, otherwise the first pipeline run does this).**
  - `docker build`, then run the image against a local Postgres.
  - `curl /api/health`, sign in, and play one order. Get the owner's go-ahead first, because it
    spends tokens.
  - `docker stop -t 600` in the middle of a burst, and confirm the burst commits before the
    container exits.
- **Infrastructure.** `az bicep build` on every entry point, and `what-if` before the first
  platform deploy.
- **End to end,** per runbook step 8, including one cold start.

## Open items

- Confirm on the real subscription:
  - the allowed regions;
  - that the Postgres free tier applies;
  - whether model quota is zero (runbook step 1).
- On the first live call, check whether the usage object reports cache writes. If it does, map
  them into `cacheWriteTokens` and add OpenAI's cache-write rates.
- When to land `player-as-a-character` on `main`.

[1]: https://learn.microsoft.com/en-us/answers/questions/5949792/azure-for-students-unable-to-deploy-any-azure-open
[2]: https://learn.microsoft.com/en-us/answers/questions/5915417/cannot-deploy-gpt-models-in-azure-ai-foundry-using
[3]: https://learn.microsoft.com/en-us/answers/questions/5870175/azure-for-students-requestdisallowedbyazure-policy
[4]: https://prices.azure.com/api/retail/prices
