# TempoMail

**Every email. Right on time.**

TempoMail is a scheduled email automation application. Users can create an account, compose an email, schedule delivery, and monitor delivery status from a React dashboard

## Features

- User registration and login with bcrypt password hashing and JWT authentication
- Schedule emails for future delivery
- PostgreSQL persistence for users, emails, and delivery logs
- Redis-backed BullMQ queue for delayed email jobs
- Background worker with configurable concurrency and rate limiting
- Automatic retry with exponential backoff
- Recovery of scheduled emails whose queue jobs are missing after a restart
- Dashboard views for overview, all emails, scheduled emails, sent emails, and activity
- Search and status filtering
- API and worker health reporting

## Architecture

```mermaid
flowchart LR
    U[User] --> FE[React + Vite Dashboard]
    FE --> API[Express REST API]
    API --> PG[(PostgreSQL)]
    API --> Q[BullMQ Queue]
    Q <--> R[(Redis)]
    W[Node.js Email Worker] --> Q
    W --> PG
    W --> SMTP[SMTP Provider]
    API --> H[Health Endpoint]
    H --> PG
    H --> R
```

**Scheduling flow**

1. The authenticated frontend sends an email and its scheduled time to the API.
2. The API validates the request and stores the email in PostgreSQL.
3. The API adds a delayed job to BullMQ using the email UUID as its job ID.
4. The worker processes due jobs, sends the email through SMTP, and records the result.
5. If a queue job is missing, the worker's recovery service recreates it from scheduled database records.

## Technology stack

| Layer | Technology |
|---|---|
| Frontend | React, Vite, Axios, Lucide |
| Backend | Node.js, Express |
| Database | PostgreSQL |
| Queue | BullMQ |
| Queue storage | Redis |
| Email | Nodemailer + SMTP |
| Authentication | JWT + bcryptjs |
| Validation | Zod |
| Local infrastructure | Docker Compose |

## Prerequisites

- Node.js 20 or newer (a current LTS release is recommended)
- npm
- Docker Desktop with Docker Compose
- An SMTP account/provider for sending email

## Local setup

### 1. Start PostgreSQL and Redis

From the project root:

```bash
docker compose up -d
docker compose ps
```

The Compose file uses local-development defaults. Do not expose these default credentials to the internet or reuse them in production.

### 2. Configure the backend

```bash
cd backend
cp .env.example .env
```

Edit `backend/.env` and set a strong, unique `JWT_SECRET` and your SMTP credentials. Do not commit `.env`.

The default local database URL must match the PostgreSQL values in `docker-compose.yml`:

```env
DATABASE_URL=postgresql://tempomail_user:tempomail_dev_password@localhost:5432/tempomail
```

### 3. Install backend dependencies and initialize the database

```bash
cd backend
npm install
```

Apply the schema to the local database:

```bash
docker compose exec -T postgres psql -U tempomail_user -d tempomail < src/models/schema.sql
```

The schema uses `gen_random_uuid()`. PostgreSQL 17 provides this function.

### 4. Install frontend dependencies

Open another terminal:

```bash
cd frontend
npm install
```

### 5. Start the application

Keep three terminals open.

**Terminal 1 — API**

```bash
cd backend
npm run dev
```

API: `http://localhost:5001`

**Terminal 2 — background worker**

```bash
cd backend
npm run worker:dev
```

**Terminal 3 — frontend**

```bash
cd frontend
npm run dev
```

Open the Vite URL shown in the frontend terminal (normally `http://localhost:5173`).

## Environment variables

See `backend/.env.example` for all backend settings.

| Variable | Purpose |
|---|---|
| `PORT` | Express API port (default 5001) |
| `CLIENT_URL` | Additional allowed frontend origin |
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_HOST`, `REDIS_PORT` | Redis connection |
| `JWT_SECRET` | Secret used to sign and verify JWTs |
| `EMAIL_HOST`, `EMAIL_PORT` | SMTP server |
| `EMAIL_USER`, `EMAIL_PASS` | SMTP credentials |
| `EMAIL_FROM` | Sender address |
| `EMAIL_MAX_ATTEMPTS` | Maximum BullMQ delivery attempts |
| `EMAIL_RETRY_DELAY_MS` | Initial exponential-backoff delay |
| `EMAIL_WORKER_CONCURRENCY` | Number of jobs the worker can process concurrently |
| `EMAIL_RATE_LIMIT_MAX` | Maximum jobs in the limiter window |
| `EMAIL_RATE_LIMIT_DURATION_MS` | Rate-limiter window in milliseconds |
| `SIMULATE_EMAIL_FAILURE` | Optional test-only retry simulation; keep `false` for normal use |

The frontend API client currently targets `http://localhost:5001/api`. For deployment, configure the API URL for the target environment rather than using localhost.

## API overview

All email endpoints require `Authorization: Bearer <JWT>`.

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/auth/register` | Create an account |
| `POST` | `/api/auth/login` | Log in |
| `GET` | `/api/auth/me` | Get the authenticated user |
| `GET` | `/api/health` | API, database, Redis, and worker health |
| `POST` | `/api/emails` | Create and schedule an email |
| `GET` | `/api/emails` | List the authenticated user's emails |
| `GET` | `/api/emails?status=sent` | Filter by status |
| `GET` | `/api/emails/stats` | User-scoped dashboard statistics |
| `GET` | `/api/emails/queue-status` | BullMQ queue counts |

Email list pagination supports `page` and `limit` query parameters. The maximum page size is 50.

## Reliability notes

- Email records are stored in PostgreSQL before queue insertion.
- If queue insertion fails, the database record remains available for recovery.
- The worker checks for missing scheduled/queued jobs at startup and periodically.
- BullMQ retry settings are configured in `backend/src/queues/emailQueue.js`.
- The worker updates email status and writes delivery events to `email_logs`.

SMTP delivery is dependent on the configured provider. A successful SMTP submission means the provider accepted the message; it does not guarantee that the recipient's mailbox displayed it or that it avoided spam filtering.

## Useful commands

```bash
# Backend
cd backend
npm run dev
npm run worker:dev
npm test

# Frontend
cd frontend
npm run dev
npm run build
npm run lint

# Infrastructure (from project root)
docker compose up -d
docker compose ps
docker compose logs -f postgres redis
docker compose down
```

`docker compose down` stops containers but keeps named volumes. Avoid `docker compose down -v` unless you intentionally want to delete the local database and Redis data.

## Security checklist before sharing or deployment

- Keep `.env` out of Git; commit only `.env.example`.
- Use a unique, long, randomly generated `JWT_SECRET`.
- Rotate any SMTP credentials or JWT secrets that have ever been exposed.
- Replace the local-development Docker credentials for any shared or deployed environment.
- Use HTTPS and production-grade secrets management when deployed.
- Restrict CORS to the actual frontend origin.
- Configure SMTP sender/domain authentication with the provider.
- Do not use `SIMULATE_EMAIL_FAILURE=true` in normal operation.

## Demo walkthrough (about 5 minutes)

1. Register or log in.
2. Show the dashboard and service health.
3. Compose an email and schedule it a few minutes into the future.
4. Show it under Scheduled.
5. Show the worker processing the job and the email moving to Sent.
6. Open the SMTP provider's test inbox/preview to demonstrate the delivered message.
7. Explain the Redis/BullMQ queue, retry policy, and database-backed recovery mechanism.

## Project structure

```text
TempoMail/
├── backend/
│   ├── src/
│   │   ├── config/
│   │   ├── controllers/
│   │   ├── middleware/
│   │   ├── models/
│   │   ├── queues/
│   │   ├── routes/
│   │   ├── services/
│   │   ├── workers/
│   │   ├── server.js
│   │   └── worker.js
│   ├── .env.example
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── services/
│   │   ├── App.jsx
│   │   └── App.css
│   └── package.json
├── docker-compose.yml
└── README.md
```

## Current project status

This repository documents the local development setup. Run the build, lint, API, and end-to-end checks in your environment before treating a commit as release-ready. No production deployment is implied.
