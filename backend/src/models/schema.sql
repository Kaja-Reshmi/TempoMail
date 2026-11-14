
-- ==========================================
-- TEMPOMAIL DATABASE SCHEMA
-- PostgreSQL 17
-- ==========================================

-- 1. USERS TABLE
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower
ON users (LOWER(email));


-- 2. EMAILS TABLE
CREATE TABLE IF NOT EXISTS emails (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL
        REFERENCES users(id) ON DELETE CASCADE,

    to_email VARCHAR(255) NOT NULL,
    subject VARCHAR(255) NOT NULL,
    body_text TEXT,
    body_html TEXT,

    scheduled_at TIMESTAMPTZ NOT NULL,

    status VARCHAR(20) NOT NULL DEFAULT 'scheduled'
        CHECK (
            status IN (
                'draft',
                'scheduled',
                'queued',
                'processing',
                'sent',
                'failed',
                'cancelled'
            )
        ),

    queue_job_id VARCHAR(255) UNIQUE,

    attempts INTEGER NOT NULL DEFAULT 0
        CHECK (attempts >= 0),

    max_attempts INTEGER NOT NULL DEFAULT 3
        CHECK (max_attempts > 0),

    last_error TEXT,
    provider_message_id VARCHAR(255),

    sent_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- 3. EMAIL DELIVERY LOGS
CREATE TABLE IF NOT EXISTS email_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    email_id UUID NOT NULL
        REFERENCES emails(id) ON DELETE CASCADE,

    event_type VARCHAR(50) NOT NULL,

    details JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- 4. PERFORMANCE INDEXES

CREATE INDEX IF NOT EXISTS idx_emails_user_status
ON emails (user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_emails_scheduled
ON emails (scheduled_at)
WHERE status IN ('scheduled', 'queued');

CREATE INDEX IF NOT EXISTS idx_email_logs_email
ON email_logs (email_id, created_at DESC);


-- 5. AUTOMATIC UPDATED_AT TIMESTAMP

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;


DROP TRIGGER IF EXISTS users_updated_at ON users;

CREATE TRIGGER users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION update_updated_at();


DROP TRIGGER IF EXISTS emails_updated_at ON emails;

CREATE TRIGGER emails_updated_at
BEFORE UPDATE ON emails
FOR EACH ROW
EXECUTE FUNCTION update_updated_at();
