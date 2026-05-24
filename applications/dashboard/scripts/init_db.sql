-- Initial database setup: extensions only.
-- Tables are created by SQLAlchemy on startup; seed data is inserted by the backend lifespan hook.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
