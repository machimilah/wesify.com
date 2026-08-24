-- Privacy-safe reusable pattern evidence, aggregated by industry.
-- Only platform-owned ids and counts live here; workspace receipts remain workspace-local.
alter table industry_knowledge add column if not exists patterns jsonb not null default '{}'::jsonb;
