import {
    PAGE_TYPE_SEEDS,
    TAXONOMY_TERM_SEEDS,
} from '@sitesensory/contracts'
import { sql, type Kysely } from 'kysely'

/**
 * 建立第一版正式資料、工作狀態與私人收藏需要的資料表。
 *
 * @param database Kysely migration 連線。
 * @returns 完成時不回傳內容。
 */
export async function up(database: Kysely<unknown>): Promise<void>
{
    await sql`
        CREATE EXTENSION IF NOT EXISTS vector;

        CREATE TABLE users (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            display_name text NOT NULL,
            status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE TABLE auth_identities (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
            provider text NOT NULL,
            provider_subject text NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE (provider, provider_subject)
        );

        CREATE TABLE page_types (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            key text NOT NULL UNIQUE,
            name text NOT NULL,
            display_order integer NOT NULL,
            status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE TABLE taxonomy_terms (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            group_key text NOT NULL CHECK (group_key IN ('industry', 'style', 'layout', 'color', 'motion')),
            key text NOT NULL,
            name text NOT NULL,
            display_order integer NOT NULL,
            status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE (group_key, key)
        );

        CREATE TABLE sites (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            registrable_domain text NOT NULL UNIQUE,
            name text,
            primary_industry_term_id uuid REFERENCES taxonomy_terms(id) ON DELETE SET NULL,
            status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked', 'archived')),
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE TABLE site_languages (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            site_id uuid NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
            language_code text NOT NULL,
            role text NOT NULL CHECK (role IN ('primary', 'supported')),
            source text NOT NULL CHECK (source IN ('system', 'ai', 'human')),
            confidence double precision CHECK (confidence >= 0 AND confidence <= 1),
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE (site_id, language_code)
        );

        CREATE TABLE pages (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            site_id uuid NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
            canonical_url text NOT NULL,
            normalized_url_hash text NOT NULL UNIQUE,
            current_version_id uuid,
            page_type_id uuid REFERENCES page_types(id) ON DELETE SET NULL,
            status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'blocked', 'archived')),
            last_checked_at timestamptz,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE TABLE page_urls (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            page_id uuid NOT NULL REFERENCES pages(id) ON DELETE RESTRICT,
            normalized_url text NOT NULL UNIQUE,
            kind text NOT NULL CHECK (kind IN ('canonical', 'redirect', 'alias')),
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE TABLE assets (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            object_key text NOT NULL UNIQUE,
            sha256 text NOT NULL,
            mime_type text NOT NULL,
            width integer CHECK (width > 0),
            height integer CHECK (height > 0),
            byte_size bigint NOT NULL CHECK (byte_size >= 0),
            kind text NOT NULL CHECK (kind IN ('viewport', 'full_page', 'region', 'saved_preview', 'capture_source')),
            created_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE TABLE page_versions (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            page_id uuid NOT NULL REFERENCES pages(id) ON DELETE RESTRICT,
            version_number integer NOT NULL CHECK (version_number > 0),
            final_url text NOT NULL,
            title text,
            content_fingerprint text NOT NULL,
            viewport_asset_id uuid REFERENCES assets(id) ON DELETE RESTRICT,
            full_page_asset_id uuid REFERENCES assets(id) ON DELETE RESTRICT,
            capture_profile_key text NOT NULL,
            captured_at timestamptz NOT NULL,
            published_at timestamptz,
            status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'processing', 'review_required', 'published', 'rejected')),
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE (page_id, version_number),
            UNIQUE (page_id, content_fingerprint)
        );

        ALTER TABLE pages
            ADD CONSTRAINT pages_current_version_id_fkey
            FOREIGN KEY (current_version_id) REFERENCES page_versions(id) ON DELETE SET NULL;

        CREATE TABLE page_languages (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            page_version_id uuid NOT NULL REFERENCES page_versions(id) ON DELETE RESTRICT,
            language_code text NOT NULL,
            role text NOT NULL CHECK (role IN ('primary', 'supported')),
            source text NOT NULL CHECK (source IN ('system', 'ai', 'human')),
            confidence double precision CHECK (confidence >= 0 AND confidence <= 1),
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE (page_version_id, language_code)
        );

        CREATE TABLE visual_regions (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            page_version_id uuid NOT NULL REFERENCES page_versions(id) ON DELETE RESTRICT,
            asset_id uuid REFERENCES assets(id) ON DELETE RESTRICT,
            kind text NOT NULL CHECK (kind IN ('full_page', 'viewport', 'system_region', 'query_region')),
            label text,
            source text NOT NULL CHECK (source IN ('system', 'ai', 'user')),
            x double precision NOT NULL CHECK (x >= 0 AND x <= 1),
            y double precision NOT NULL CHECK (y >= 0 AND y <= 1),
            width double precision NOT NULL CHECK (width > 0 AND width <= 1),
            height double precision NOT NULL CHECK (height > 0 AND height <= 1),
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            CHECK (x + width <= 1),
            CHECK (y + height <= 1)
        );

        CREATE TABLE embedding_models (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            provider text NOT NULL,
            model_name text NOT NULL,
            model_version text NOT NULL,
            dimensions integer NOT NULL CHECK (dimensions > 0),
            status text NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate', 'active', 'retired')),
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE (provider, model_name, model_version)
        );

        CREATE TABLE visual_embeddings (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            visual_region_id uuid NOT NULL REFERENCES visual_regions(id) ON DELETE RESTRICT,
            model_id uuid NOT NULL REFERENCES embedding_models(id) ON DELETE RESTRICT,
            embedding vector NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE (visual_region_id, model_id)
        );

        CREATE TABLE analysis_runs (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            page_version_id uuid NOT NULL REFERENCES page_versions(id) ON DELETE RESTRICT,
            runner text NOT NULL,
            model_name text,
            model_version text,
            prompt_version text NOT NULL,
            schema_version text NOT NULL,
            status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'rejected')),
            started_at timestamptz,
            completed_at timestamptz,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE TABLE analysis_results (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            analysis_run_id uuid NOT NULL UNIQUE REFERENCES analysis_runs(id) ON DELETE RESTRICT,
            result jsonb NOT NULL,
            summary text NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE TABLE page_taxonomy_terms (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            page_version_id uuid NOT NULL REFERENCES page_versions(id) ON DELETE RESTRICT,
            term_id uuid NOT NULL REFERENCES taxonomy_terms(id) ON DELETE RESTRICT,
            source text NOT NULL CHECK (source IN ('ai', 'human')),
            confidence double precision CHECK (confidence >= 0 AND confidence <= 1),
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE (page_version_id, term_id)
        );

        CREATE TABLE pending_taxonomy_terms (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            analysis_run_id uuid NOT NULL REFERENCES analysis_runs(id) ON DELETE RESTRICT,
            group_key text NOT NULL CHECK (group_key IN ('industry', 'style', 'layout', 'color', 'motion')),
            suggested_name text NOT NULL,
            status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
            resolved_term_id uuid REFERENCES taxonomy_terms(id) ON DELETE SET NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE TABLE ingestion_jobs (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            idempotency_key text NOT NULL UNIQUE,
            input_url text NOT NULL,
            normalized_url text,
            page_id uuid REFERENCES pages(id) ON DELETE SET NULL,
            page_version_id uuid REFERENCES page_versions(id) ON DELETE SET NULL,
            state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'resolving', 'capturing', 'comparing', 'embedding', 'awaiting_analysis', 'analyzing', 'quality_check', 'published', 'unchanged', 'review_required', 'failed', 'rejected')),
            current_stage text,
            retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
            available_at timestamptz NOT NULL DEFAULT now(),
            lease_owner text,
            lease_token text,
            lease_expires_at timestamptz,
            last_error_code text,
            last_error_summary text,
            started_at timestamptz,
            completed_at timestamptz,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE TABLE job_attempts (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            job_id uuid NOT NULL REFERENCES ingestion_jobs(id) ON DELETE RESTRICT,
            stage text NOT NULL,
            attempt_number integer NOT NULL CHECK (attempt_number > 0),
            status text NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
            error_code text,
            error_summary text,
            started_at timestamptz NOT NULL,
            completed_at timestamptz,
            created_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE (job_id, stage, attempt_number)
        );

        CREATE TABLE version_comparisons (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            page_id uuid NOT NULL REFERENCES pages(id) ON DELETE RESTRICT,
            baseline_page_version_id uuid REFERENCES page_versions(id) ON DELETE RESTRICT,
            candidate_asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
            resulting_page_version_id uuid REFERENCES page_versions(id) ON DELETE RESTRICT,
            perceptual_hash_distance double precision,
            image_difference double precision,
            color_distance double precision,
            layout_difference double precision,
            text_difference double precision,
            rule_version text NOT NULL,
            decision text NOT NULL CHECK (decision IN ('unchanged', 'new_version', 'review_required')),
            created_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE TABLE saved_views (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
            page_version_id uuid NOT NULL REFERENCES page_versions(id) ON DELETE RESTRICT,
            preview_asset_id uuid REFERENCES assets(id) ON DELETE SET NULL,
            x double precision NOT NULL DEFAULT 0 CHECK (x >= 0 AND x <= 1),
            y double precision NOT NULL DEFAULT 0 CHECK (y >= 0 AND y <= 1),
            width double precision NOT NULL DEFAULT 1 CHECK (width > 0 AND width <= 1),
            height double precision NOT NULL DEFAULT 1 CHECK (height > 0 AND height <= 1),
            reason text,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            CHECK (x + width <= 1),
            CHECK (y + height <= 1)
        );

        CREATE TABLE user_tags (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
            name text NOT NULL,
            normalized_name text NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE (user_id, normalized_name)
        );

        CREATE TABLE saved_view_tags (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            saved_view_id uuid NOT NULL REFERENCES saved_views(id) ON DELETE CASCADE,
            tag_id uuid NOT NULL REFERENCES user_tags(id) ON DELETE CASCADE,
            created_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE (saved_view_id, tag_id)
        );

        CREATE TABLE activity_events (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id uuid REFERENCES users(id) ON DELETE SET NULL,
            event_type text NOT NULL,
            subject_type text NOT NULL,
            subject_id uuid,
            properties jsonb NOT NULL DEFAULT '{}'::jsonb,
            schema_version text NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE INDEX pages_site_id_idx ON pages(site_id);
        CREATE INDEX page_versions_latest_idx ON page_versions(page_id, version_number DESC);
        CREATE INDEX visual_regions_page_version_id_idx ON visual_regions(page_version_id);
        CREATE INDEX ingestion_jobs_claim_idx ON ingestion_jobs(state, available_at, lease_expires_at);
        CREATE INDEX page_taxonomy_terms_term_id_idx ON page_taxonomy_terms(term_id, page_version_id);
        CREATE INDEX saved_views_user_id_idx ON saved_views(user_id, created_at DESC);
        CREATE INDEX activity_events_user_id_idx ON activity_events(user_id, created_at DESC);

        CREATE FUNCTION prevent_created_at_update() RETURNS trigger AS $$
        BEGIN
            IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
                RAISE EXCEPTION 'created_at is immutable';
            END IF;

            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        DO $$
        DECLARE
            table_name text;
        BEGIN
            FOREACH table_name IN ARRAY ARRAY[
                'users', 'auth_identities', 'page_types', 'taxonomy_terms', 'sites',
                'site_languages', 'pages', 'page_urls', 'assets', 'page_versions',
                'page_languages', 'visual_regions', 'embedding_models', 'visual_embeddings',
                'analysis_runs', 'analysis_results', 'page_taxonomy_terms',
                'pending_taxonomy_terms', 'ingestion_jobs', 'job_attempts',
                'version_comparisons', 'saved_views', 'user_tags', 'saved_view_tags',
                'activity_events'
            ]
            LOOP
                EXECUTE format(
                    'CREATE TRIGGER %I_created_at_immutable BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION prevent_created_at_update()',
                    table_name,
                    table_name
                );
            END LOOP;
        END;
        $$;
    `.execute(database)

    for (const [displayOrder, seed] of PAGE_TYPE_SEEDS.entries()) {
        await sql`
            INSERT INTO page_types (key, name, display_order)
            VALUES (${seed.key}, ${seed.name}, ${displayOrder})
        `.execute(database)
    }

    for (const [displayOrder, seed] of TAXONOMY_TERM_SEEDS.entries()) {
        await sql`
            INSERT INTO taxonomy_terms (group_key, key, name, display_order)
            VALUES (${seed.groupKey}, ${seed.key}, ${seed.name}, ${displayOrder})
        `.execute(database)
    }
}

/**
 * 移除第一版資料表，供尚未寫入正式資料的 migration 回滾使用。
 *
 * @param database Kysely migration 連線。
 * @returns 完成時不回傳內容。
 */
export async function down(database: Kysely<unknown>): Promise<void>
{
    await sql`
        DROP TABLE IF EXISTS activity_events;
        DROP TABLE IF EXISTS saved_view_tags;
        DROP TABLE IF EXISTS user_tags;
        DROP TABLE IF EXISTS saved_views;
        DROP TABLE IF EXISTS version_comparisons;
        DROP TABLE IF EXISTS job_attempts;
        DROP TABLE IF EXISTS ingestion_jobs;
        DROP TABLE IF EXISTS pending_taxonomy_terms;
        DROP TABLE IF EXISTS page_taxonomy_terms;
        DROP TABLE IF EXISTS analysis_results;
        DROP TABLE IF EXISTS analysis_runs;
        DROP TABLE IF EXISTS visual_embeddings;
        DROP TABLE IF EXISTS embedding_models;
        DROP TABLE IF EXISTS visual_regions;
        DROP TABLE IF EXISTS page_languages;
        ALTER TABLE IF EXISTS pages DROP CONSTRAINT IF EXISTS pages_current_version_id_fkey;
        DROP TABLE IF EXISTS page_versions;
        DROP TABLE IF EXISTS assets;
        DROP TABLE IF EXISTS page_urls;
        DROP TABLE IF EXISTS pages;
        DROP TABLE IF EXISTS site_languages;
        DROP TABLE IF EXISTS sites;
        DROP TABLE IF EXISTS taxonomy_terms;
        DROP TABLE IF EXISTS page_types;
        DROP TABLE IF EXISTS auth_identities;
        DROP TABLE IF EXISTS users;
        DROP FUNCTION IF EXISTS prevent_created_at_update();
        DROP EXTENSION IF EXISTS vector;
    `.execute(database)
}
