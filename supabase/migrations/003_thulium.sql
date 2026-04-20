-- ============================================================
-- Thulium (Contact Center) — BOK/CS dashboard tables
-- ============================================================

-- Per-connection fact table (one row per call)
CREATE TABLE IF NOT EXISTS fact_thulium_connections (
    connection_id TEXT PRIMARY KEY,
    date DATE NOT NULL,
    direction TEXT NOT NULL,              -- 'in' | 'out'
    queue_id TEXT,
    queue_name TEXT,
    agent_login TEXT,
    start_at TIMESTAMPTZ,
    wait_seconds INTEGER DEFAULT 0,
    talk_seconds INTEGER DEFAULT 0,
    result TEXT,                           -- 'answered' | 'abandoned' | 'missed'
    answered_in_sla BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_thulium_connections_date ON fact_thulium_connections(date);
CREATE INDEX IF NOT EXISTS idx_thulium_connections_agent ON fact_thulium_connections(agent_login, date);
CREATE INDEX IF NOT EXISTS idx_thulium_connections_queue ON fact_thulium_connections(queue_id, date);

-- Daily agent work report (aggregated per day per agent)
CREATE TABLE IF NOT EXISTS fact_thulium_agent_work_daily (
    date DATE NOT NULL,
    agent_login TEXT NOT NULL,
    logged_seconds INTEGER DEFAULT 0,
    talk_seconds INTEGER DEFAULT 0,
    pause_seconds INTEGER DEFAULT 0,
    calls_handled INTEGER DEFAULT 0,
    PRIMARY KEY (date, agent_login)
);

-- Tickets (BOK/CS support cases)
CREATE TABLE IF NOT EXISTS fact_thulium_tickets (
    ticket_id TEXT PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL,
    resolved_at TIMESTAMPTZ,
    first_response_at TIMESTAMPTZ,
    status TEXT,
    category TEXT,
    queue_id TEXT,
    queue_name TEXT,
    agent_login TEXT,
    sla_breached BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_thulium_tickets_created ON fact_thulium_tickets(created_at);
CREATE INDEX IF NOT EXISTS idx_thulium_tickets_status ON fact_thulium_tickets(status);
CREATE INDEX IF NOT EXISTS idx_thulium_tickets_queue ON fact_thulium_tickets(queue_id);

-- Daily chat summary (one row per day per queue)
CREATE TABLE IF NOT EXISTS fact_thulium_chats_daily (
    date DATE NOT NULL,
    queue_id TEXT NOT NULL,
    queue_name TEXT,
    conversations INTEGER DEFAULT 0,
    avg_response_seconds INTEGER,
    PRIMARY KEY (date, queue_id)
);

-- Daily outbound campaign stats
CREATE TABLE IF NOT EXISTS fact_thulium_outbound_daily (
    date DATE NOT NULL,
    outbound_id TEXT NOT NULL,
    outbound_name TEXT,
    records_done INTEGER DEFAULT 0,
    records_todo INTEGER DEFAULT 0,
    PRIMARY KEY (date, outbound_id)
);
