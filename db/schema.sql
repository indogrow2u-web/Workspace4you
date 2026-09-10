-- ============================================================
-- Workspace4You — Virtual Address Application System
-- File: db/schema.sql
--
-- Run this once against your Postgres database before deploying
-- Phase 1. Easiest way: your database's dashboard → "Query" /
-- "SQL Editor" tab → paste this whole file → Run. Safe to re-run
-- (CREATE ... IF NOT EXISTS + ALTER ... ADD COLUMN IF NOT EXISTS
-- throughout), including after the email-OTP change below.
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

  -- Personal (Step 2). Verification currently runs over EMAIL (via Resend)
  -- rather than SMS OTP — mobile is still collected but not verified yet.
  -- Swapping back to SMS later just means re-populating mobile_verified_at
  -- the same way; nothing else about the schema needs to change.
  full_name              TEXT,
  mobile                 TEXT,
  mobile_verified_at     TIMESTAMPTZ,
  email                  TEXT,
  email_verified_at      TIMESTAMPTZ,

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
  expiry_reminder_sent_at TIMESTAMPTZ, -- set once a "renewal coming up" email has gone out, so the daily check doesn't re-send it
  agreement_generated_at   TIMESTAMPTZ, -- when admin-generate-agreement.js last ran, for the "still not accepted" reminder below
  agreement_reminder_sent_at TIMESTAMPTZ, -- set once a "please accept your agreement" nudge has gone out

  -- Refund — Phase 4
  refund_status           TEXT NOT NULL DEFAULT 'none', -- none | pending | processed | failed

  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Safe to run against a table created before the email-OTP switch.
ALTER TABLE applications ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
-- Safe to run against a table created before expiry reminders/refund.failed existed.
ALTER TABLE applications ADD COLUMN IF NOT EXISTS expiry_reminder_sent_at TIMESTAMPTZ;
-- Safe to run against a table created before agreement reminders existed.
ALTER TABLE applications ADD COLUMN IF NOT EXISTS agreement_generated_at TIMESTAMPTZ;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS agreement_reminder_sent_at TIMESTAMPTZ;

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

-- OTP challenges (signup verification + Track Application access).
-- channel is 'email' for now (Resend) — SMS can be added later as a
-- second channel value without touching this shape.
CREATE TABLE IF NOT EXISTS otp_challenges (
  id                SERIAL PRIMARY KEY,
  application_id    INTEGER REFERENCES applications(id) ON DELETE CASCADE,
  purpose           TEXT NOT NULL, -- signup | track
  channel           TEXT NOT NULL DEFAULT 'email', -- email | sms
  mobile            TEXT,
  email             TEXT,
  ip                TEXT,
  otp_hash          TEXT,
  attempts          INTEGER NOT NULL DEFAULT 0,
  expires_at        TIMESTAMPTZ NOT NULL,
  verified_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Safe to run against a table created before the email-OTP switch (which
-- had mobile NOT NULL and no channel/email/otp_hash columns).
ALTER TABLE otp_challenges ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'email';
ALTER TABLE otp_challenges ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE otp_challenges ADD COLUMN IF NOT EXISTS otp_hash TEXT;
ALTER TABLE otp_challenges ADD COLUMN IF NOT EXISTS ip TEXT;
ALTER TABLE otp_challenges ALTER COLUMN mobile DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_otp_mobile ON otp_challenges (mobile, purpose);
CREATE INDEX IF NOT EXISTS idx_otp_email ON otp_challenges (email, purpose);
CREATE INDEX IF NOT EXISTS idx_otp_email_created ON otp_challenges (email, created_at);
CREATE INDEX IF NOT EXISTS idx_otp_ip_created ON otp_challenges (ip, created_at);

-- Multiple simultaneous access tokens per application (one per device/
-- browser that has authenticated), so opening a resume link or Track
-- Application on a second device no longer silently invalidates the
-- first. applications.access_token_hash is kept (still set at creation)
-- but is no longer what's checked — see api/_appAuth.js.
CREATE TABLE IF NOT EXISTS application_sessions (
  id              SERIAL PRIMARY KEY,
  application_id  INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  token_hash      TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,
  last_used_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sessions_application ON application_sessions (application_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON application_sessions (token_hash);

-- ============================================================
-- Phase 2 — verification documents, agreement templates
-- ============================================================

-- Uploaded documents (identity proof etc). Stored as bytes directly in
-- Postgres rather than a public object store, so every read must go
-- through our own authenticated api/applications/document.js — never a
-- public URL. Keep uploads small (enforced server-side, ~3MB cap).
CREATE TABLE IF NOT EXISTS application_documents (
  id              SERIAL PRIMARY KEY,
  application_id  INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  doc_type        TEXT NOT NULL, -- identity | business_proof | other
  filename        TEXT NOT NULL,
  mime_type       TEXT NOT NULL,
  size_bytes      INTEGER NOT NULL,
  data            BYTEA NOT NULL,
  uploaded_by     TEXT NOT NULL DEFAULT 'customer', -- customer | admin
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_documents_application ON application_documents (application_id);

-- Agreement templates. Only one row may be 'published' at a time — that's
-- the version used whenever an admin generates a new agreement. Every
-- application stores its own frozen agreement_snapshot (see applications
-- table above), so publishing a new version here never changes an
-- agreement already issued to a customer.
CREATE TABLE IF NOT EXISTS agreement_templates (
  id             SERIAL PRIMARY KEY,
  version        TEXT NOT NULL,
  content        TEXT NOT NULL, -- HTML with {{placeholders}}
  status         TEXT NOT NULL DEFAULT 'draft', -- draft | published | archived
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_agreement_templates_status ON agreement_templates (status);

-- Seed one DRAFT starter template so the admin has something to review
-- and customize rather than an empty editor. Deliberately left as a
-- draft — nothing gets used for a real agreement until an admin reads
-- it, edits it to reflect your actual terms, and explicitly publishes
-- it from Admin -> Agreement Templates.
INSERT INTO agreement_templates (version, content, status)
SELECT 'v1.0-draft',
$TEMPLATE$<h2>Virtual Office Service Agreement</h2>
<p><em>DRAFT — review and edit every clause below before publishing. This is placeholder text, not legal advice.</em></p>
<p>This agreement is made between <strong>INDO GROW</strong> ("Service Provider") and <strong>{{customerName}}</strong>, on behalf of <strong>{{businessName}}</strong> ("Client"), a {{businessType}} identified by {{businessIdentifier}}.</p>
<h3>1. Service</h3>
<p>The Service Provider grants the Client use of the business address <strong>{{virtualAddress}}</strong> as a registered/correspondence address, under the <strong>{{planName}}</strong> plan ({{duration}}).</p>
<h3>2. Term</h3>
<p>This agreement is effective from <strong>{{startDate}}</strong> to <strong>{{endDate}}</strong>, renewable by mutual agreement.</p>
<h3>3. Permitted Use</h3>
<p>The address may be used for: {{permittedUse}}.</p>
<h3>4. Application Reference</h3>
<p>Application ID: {{applicationCode}}</p>
<h3>5. Cancellation</h3>
<p>[Replace with your actual cancellation/refund policy.]</p>
$TEMPLATE$,
'draft'
WHERE NOT EXISTS (SELECT 1 FROM agreement_templates);
