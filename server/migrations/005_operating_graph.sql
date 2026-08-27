-- How the business actually runs: every step, and every link between steps.
--
-- Customer → Order → Production → Shipment → Invoice → Payment. That chain is the thing an operator
-- is really buying, and until now Wesify only ever held it implicitly — scattered across a manifest's
-- entity list, an automation's trigger, and a workflow canvas saved in one browser. Nothing could
-- answer "what happens after an order is placed" without a person reading three screens and joining
-- them in their head.
--
-- Two tables, because a graph is two things. Nodes are what exists; edges are what follows what.
-- Keeping them apart means a step can be renamed without touching the six links that point at it,
-- and a link can be corrected without inventing a node to hang the correction on.
--
-- This is the operating model, not the record data. A node called "Invoice" says this business issues
-- invoices and says where invoicing sits in the flow; the invoices themselves are rows in `records`,
-- and `entity_id` is the thread between the two.

create table if not exists operating_nodes (
  workspace_id text        not null,
  id           text        not null,
  -- What kind of thing this is:
  --   entity    something the business keeps records of      — Customer, Order, Invoice
  --   process   something the business does                  — Production, Fulfilment
  --   actor     somebody who acts                            — Sales rep, Technician, Supplier
  --   event     something that happens and is reacted to     — Payment received, Stock low
  --   system    something outside Wesify that is involved     — Stripe, the accounting package
  kind         text        not null default 'process',
  label        text        not null default '',
  -- The records entity this node stands for, where one exists. Null for a step that produces no
  -- records of its own. Deliberately not a foreign key: entity ids belong to the generated manifest,
  -- which is versioned and rebuilt, and a rebuild must not be able to break the graph.
  entity_id    text,
  -- Which part of the Command Center this belongs to — 'sales', 'inventory', 'finance'.
  module       text        not null default '',
  -- Where it sits when the graph is drawn. Held so the picture an operator arranged survives them
  -- closing the tab.
  position     jsonb       not null default '{}'::jsonb,
  detail       jsonb       not null default '{}'::jsonb,
  source       text        not null default 'ai',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (workspace_id, id),
  constraint operating_nodes_kind_check check (kind in ('entity', 'process', 'actor', 'event', 'system')),
  constraint operating_nodes_source_check check (source in ('user', 'ai', 'interview', 'connector', 'system'))
);

create index if not exists operating_nodes_entity_idx on operating_nodes (workspace_id, entity_id);

-- What follows what.
--
-- The composite foreign keys are the point of this table. An edge cannot name a step that does not
-- exist in the same workspace, so the graph cannot quietly acquire a link into nowhere, and it cannot
-- acquire one that reaches into a different company's graph.
create table if not exists operating_edges (
  workspace_id text        not null,
  id           text        not null,
  from_node    text        not null,
  to_node      text        not null,
  -- What the link means:
  --   flows-to    the ordinary next step        Order → Production
  --   triggers    causes it to start            Payment received → Order closed
  --   produces    brings it into existence      Production → Shipment
  --   requires    cannot proceed without it     Shipment → Stock
  --   owns        is responsible for it         Sales rep → Customer
  --   references  points at it without ordering Invoice → Order
  relation     text        not null default 'flows-to',
  label        text        not null default '',
  -- The named chain this link belongs to — 'order-to-cash', 'procure-to-pay' — with `sequence` giving
  -- its place in that chain. Together they are what turns a bag of links back into the readable line
  -- an operator recognises as their business.
  flow         text        not null default '',
  sequence     integer     not null default 0,
  detail       jsonb       not null default '{}'::jsonb,
  source       text        not null default 'ai',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (workspace_id, id),
  constraint operating_edges_from_fk foreign key (workspace_id, from_node) references operating_nodes (workspace_id, id) on delete cascade,
  constraint operating_edges_to_fk foreign key (workspace_id, to_node) references operating_nodes (workspace_id, id) on delete cascade,
  constraint operating_edges_relation_check check (relation in ('flows-to', 'triggers', 'produces', 'requires', 'owns', 'references')),
  constraint operating_edges_source_check check (source in ('user', 'ai', 'interview', 'connector', 'system'))
);

-- Walking forwards from a step, which is what drawing the graph and answering "what happens next" both do.
create index if not exists operating_edges_from_idx on operating_edges (workspace_id, from_node);

-- Walking backwards: "what leads to a payment".
create index if not exists operating_edges_to_idx on operating_edges (workspace_id, to_node);

-- Reading one named chain back in order.
create index if not exists operating_edges_flow_idx on operating_edges (workspace_id, flow, sequence);
