-- ADR-003: bases lógicas con usuarios separados.
-- Corre al primer arranque del contenedor Postgres (docker-entrypoint-initdb.d).
--
-- Bases:
--   academic_main   → users, comisiones, episodes meta, Casbin policies
--   ctr_store       → events + dead_letters (CTR criptográfico append-only)
--   classifier_db   → classifications (con is_current + hash)
--   content_db      → materials + chunks (pgvector para RAG)
--   identity_store  → pseudónimo ↔ identidad (aislamiento fuerte)

-- ── Usuarios ─────────────────────────────────────────────────────────

CREATE USER academic_user   WITH PASSWORD 'academic_pass';
CREATE USER ctr_user        WITH PASSWORD 'ctr_pass';
CREATE USER classifier_user WITH PASSWORD 'classifier_pass';
CREATE USER content_user    WITH PASSWORD 'content_pass';
CREATE USER identity_user   WITH PASSWORD 'identity_pass';

-- ── Bases + ownership ────────────────────────────────────────────────

CREATE DATABASE academic_main  OWNER academic_user;
CREATE DATABASE ctr_store      OWNER ctr_user;
CREATE DATABASE classifier_db  OWNER classifier_user;
CREATE DATABASE content_db     OWNER content_user;
CREATE DATABASE identity_store OWNER identity_user;

-- ── Helper RLS reutilizable (ADR-001) ────────────────────────────────
-- Cada migration que cree tabla con tenant_id llama:
--   SELECT apply_tenant_rls('nombre_tabla');

-- ── academic_main ────────────────────────────────────────────────────

\c academic_main
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
CREATE EXTENSION IF NOT EXISTS btree_gin;

CREATE OR REPLACE FUNCTION apply_tenant_rls(table_name text)
RETURNS void AS $$
BEGIN
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
        'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.current_tenant'', true)::uuid)',
        table_name
    );
END;
$$ LANGUAGE plpgsql;

-- ── content_db (RAG con pgvector, ADR-011) ──────────────────────────

\c content_db
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

CREATE OR REPLACE FUNCTION apply_tenant_rls(table_name text)
RETURNS void AS $$
BEGIN
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
        'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.current_tenant'', true)::uuid)',
        table_name
    );
END;
$$ LANGUAGE plpgsql;

-- ── ctr_store (cadena criptográfica append-only) ────────────────────

\c ctr_store
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION apply_tenant_rls(table_name text)
RETURNS void AS $$
BEGIN
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
        'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.current_tenant'', true)::uuid)',
        table_name
    );
END;
$$ LANGUAGE plpgsql;

-- ── classifier_db ────────────────────────────────────────────────────

\c classifier_db
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE OR REPLACE FUNCTION apply_tenant_rls(table_name text)
RETURNS void AS $$
BEGIN
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
        'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.current_tenant'', true)::uuid)',
        table_name
    );
END;
$$ LANGUAGE plpgsql;

-- ── identity_store (pseudónimo ↔ identidad, aislamiento fuerte) ────

\c identity_store
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- No RLS aquí: esta DB tiene UNA fila por estudiante, no hay
-- multi-tenancy dentro (cada tenant tiene su propio deployment lógico).
-- El aislamiento se garantiza por usuario + ACLs de red.
