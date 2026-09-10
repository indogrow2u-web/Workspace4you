-- ============================================================
-- Workspace4You — Virtual Address Application System
-- File: db/schema.sql
--
-- Run this once against your Vercel Postgres (Neon) database
-- before deploying Phase 1. Easiest way: Vercel dashboard →
-- Storage → your Postgres database → "Query" tab → paste this
-- whole file → Run. Safe to re-run (everything is IF NOT EXISTS).
-- ============================================================

CREATE TABLE IF NOT EXISTS applications (
  id                     SERIAL PRIMARY KEY,
  -- Nullable at insert time (assigned right after, once we know the row's
  -- id) and only then made unique — Postgres treats multiple NULLs as
  -- non-conflicting, so concurrent creates never collide on a placeholder.
  application_code       TEXT UNIQUE,
  access_token_hash      TEXT NOT NULL,

  -- Overall application status. One of:
  -- draft, payment_pending, payment_received, verification_pending,
  -- action_required, under_review, approved, rejected,
  -- agreement_pending, agreement_sent, agreement_accepted,
  -- ready_for_activation, active, expired, terminated
  status                 TEXT NOT NULL DEFAULT 'draft',

  -- Plan (this system is scoped to Virtual Address only)
  plan_name              TEXT NOT NULL DEFAULT 'Virtual Address',
  duration               TEXT NOT NULL DEFAULT 'month', -- 'month' | 'annual'

  -- Personal (Step 2)
  full_name              TEXT,
  mobile                 TEXT,
  mobile_verified_at     TIMESTAMPTZ,
  email                  TEXT,

  -- Business (Step 3)
  business_type          TEXT, -- Proprietorship | Private Limited Company | LLP | Partnership | Other
  business_name          TEXT,
  business_activity      TEXT,
  pan                    TEXT,
  gstin                  TEXT,
  udyam_number           TEXT,
  cin                    TEXT,
  llpin                  TEXT,
  no_gst_udyam           BOOLEAN NOT NULL DEFAULT false,

  -- Address usage (Step 4)
  address_usage          JSONB NOT NULL DEFAULT '[]',
  inventory_requested    BOOLEAN NOT NULL DEFAULT false,

  -- Payment (Step 5-7) — kept separate from application/verification status (Rule: payment != approval)
  razorpay_order_id      TEXT,
  razorpay_payment_id    TEXT,
  payment_status         TEXT NOT NULL DEFAULT 'pending', -- pending | paid | failed
  payment_amount         INTEGER,
  payment_verified_at    TIMESTAMPTZ,

  -- Verification — Phase 2
  verification_status    TEXT NOT NULL DEFAULT 'not_started', -- not_started | pending | passed | failed | manual_review

  -- Admin review — Phase 2
  admin_review_status    TEXT NOT NULL DEFAULT 'not_started', -- not_started | pending | approved | rejected
  admin_notes            TEXT,
  info_requested         TEXT, -- what the admin asked the customer for, if anything

  -- Agreement — Phase 3
  agreement_version      TEXT,
  agreement_snapshot     TEXT, -- frozen HTML/text of the exact agreement issued, never re-rendered from the live template
  agreement_status        TEXT NOT NULL DEFAULT 'not_generated', -- not_generated | awaiting_acceptance | accepted
  agreement_accepted_at  TIMESTAMPTZ,

  -- Activation — Phase 3
  activation_status      TEXT NOT NULL DEFAULT 'not_activated', -- not_activated | ready | active | expired | terminated
  activation_date        DATE,
  expiry_date            DATE,

  -- Refund — Phase 4
  refund_status           TEXT NOT NULL DEFAULT 'none', -- none | pending | processed

  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_applications_mobile ON applications (mobile);
CREATE INDEX IF NOT EXISTS idx_applications_status ON applications (status);

-- Audit trail — every meaningful state change, visible to admins (Step: Audit Trail)
CREATE TABLE IF NOT EXISTS application_events (
  id              SERIAL PRIMARY KEY,
  application_id  INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  actor           TEXT NOT NULL, -- system | customer | admin
  event           TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_application ON application_events (application_id);

-- Mobile OTP challenges (signup verification + Track Application access)
CREATE TABLE IF NOT EXISTS otp_challenges (
  id                SERIAL PRIMARY KEY,
  application_id    INTEGER REFERENCES applications(id) ON DELETE CASCADE,
  purpose           TEXT NOT NULL, -- signup | track
  mobile            TEXT NOT NULL,
  msg91_request_id  TEXT,
  attempts          INTEGER NOT NULL DEFAULT 0,
  expires_at        TIMESTAMPTZ NOT NULL,
  verified_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_otp_mobile ON otp_challenges (mobile, purpose);
