-- Revenue dashboard (Admin Lite): events are read by time window.
CREATE INDEX idx_rc_events_time ON rc_events (event_timestamp_ms);
