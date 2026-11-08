--
-- Schema for the Bahn-Vorhersage "parsed train delays" parquet dataset,
-- ingested via ingest/ingest-parquet.js.
--
-- Derived from schema.de_gtfsde.sql (pre-aggregation of temp_sample_histogram by hour).
-- To keep the volume manageable:
--  * operator_id in sample_histogram_by_day/by_hour/by_month/without_time is only set for final delays
--    (prior_ttl_bucket IS NULL); rows with prior buckets have operator_id NULL.
--  * sample_histogram_by_station (line, station, operator) only contains final delays.
--
-- Differences in refresh_histograms_and_cleanup_samples():
--  * optional parameter freeze_interval (default '2 days' = previous behaviour). Each parquet file
--    contains all samples of its trips, so the parquet ingest flushes everything via a negative interval.
--  * the substitute-trip detection via remarks is omitted (no remarks in this dataset).
--  * UNION ALL branches use explicit column lists.
--
-- Idempotent: can be re-run on an existing schema (tables are only created if missing,
-- functions/procedures are replaced).
--

SET client_min_messages = warning;

CREATE SCHEMA IF NOT EXISTS de_bahnvorhersage;

--
-- Bucket functions (identical to de_db / de_gtfsde)
--

CREATE OR REPLACE FUNCTION de_bahnvorhersage.delay_bucket_range(val smallint) RETURNS int4range
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$SELECT
	CASE
	WHEN val < -90 THEN '(,-90)'::int4range
	WHEN val < -75 THEN '[-90,-75)'::int4range
	WHEN val < -60 THEN '[-75,-60)'::int4range
	WHEN val < -45 THEN '[-60,-45)'::int4range
	WHEN val < -30 THEN '[-45,-30)'::int4range
	WHEN val < -25 THEN '[-30,-25)'::int4range
	WHEN val < -20 THEN '[-25,-20)'::int4range
	WHEN val < -15 THEN '[-20,-15)'::int4range
	WHEN val < -10 THEN '[-15,-10)'::int4range
	WHEN val < -9 THEN '[-10,-9)'::int4range
	WHEN val < -8 THEN '[-9,-8)'::int4range
	WHEN val < -7 THEN '[-8,-7)'::int4range
	WHEN val < -6 THEN '[-7,-6)'::int4range
	WHEN val < -5 THEN '[-6,-5)'::int4range
	WHEN val < -4 THEN '[-5,-4)'::int4range
	WHEN val < -3 THEN '[-4,-3)'::int4range
	WHEN val < -2 THEN '[-3,-2)'::int4range
	WHEN val < -1 THEN '[-2,-1)'::int4range
	WHEN val < 0 THEN '[-1,0)'::int4range
	WHEN val < 1 THEN '[0,1)'::int4range
	WHEN val < 2 THEN '[1,2)'::int4range
	WHEN val < 3 THEN '[2,3)'::int4range
	WHEN val < 4 THEN '[3,4)'::int4range
	WHEN val < 5 THEN '[4,5)'::int4range
	WHEN val < 6 THEN '[5,6)'::int4range
	WHEN val < 7 THEN '[6,7)'::int4range
	WHEN val < 8 THEN '[7,8)'::int4range
	WHEN val < 9 THEN '[8,9)'::int4range
	WHEN val < 10 THEN '[9,10)'::int4range
	WHEN val < 11 THEN '[10,11)'::int4range
	WHEN val < 16 THEN '[11,16)'::int4range
	WHEN val < 21 THEN '[16,21)'::int4range
	WHEN val < 26 THEN '[21,26)'::int4range
	WHEN val < 31 THEN '[26,31)'::int4range
	WHEN val < 46 THEN '[31,46)'::int4range
	WHEN val < 61 THEN '[46,61)'::int4range
	WHEN val < 76 THEN '[61,76)'::int4range
	WHEN val < 91 THEN '[76,91)'::int4range
	WHEN val >= 91 THEN '[91,)'::int4range
	ELSE NULL END AS delay_bucket$$;

CREATE OR REPLACE FUNCTION de_bahnvorhersage.ttl_bucket_range(val smallint) RETURNS int4range
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$SELECT
	CASE
	WHEN val < -20 THEN '(,-20)'::int4range
	WHEN val < -15 THEN '[-20,-15)'::int4range
	WHEN val < -10 THEN '[-15,-10)'::int4range
	WHEN val < -5 THEN '[-10,-5)'::int4range
	WHEN val < 0 THEN '[-5,0)'::int4range
	WHEN val < 5 THEN '[0,5)'::int4range
	WHEN val < 10 THEN '[5,10)'::int4range
	WHEN val < 15 THEN '[10,15)'::int4range
	WHEN val < 20 THEN '[15,20)'::int4range
	WHEN val < 25 THEN '[20,25)'::int4range
	WHEN val < 30 THEN '[25,30)'::int4range
	WHEN val < 45 THEN '[30,45)'::int4range
	WHEN val < 60 THEN '[45,60)'::int4range
	WHEN val < 75 THEN '[60,75)'::int4range
	WHEN val < 90 THEN '[75,90)'::int4range
	WHEN val < 120 THEN '[90,120)'::int4range
	WHEN val < 150 THEN '[120,150)'::int4range
	WHEN val < 180 THEN '[150,180)'::int4range
	WHEN val < 240 THEN '[180,240)'::int4range
	WHEN val < 300 THEN '[240,300)'::int4range
	WHEN val < 360 THEN '[300,360)'::int4range
	WHEN val >= 360 THEN '[360,)'::int4range
	ELSE NULL END AS ttl_bucket$$;

CREATE OR REPLACE FUNCTION de_bahnvorhersage.reduced_latest_sample_ttl_bucket_range(val int4range) RETURNS int4range
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$SELECT
	CASE
	WHEN val <@ '(,-15)'::int4range THEN '(,-15)'::int4range
	WHEN val <@ '[-15,0)'::int4range THEN '[-15,0)'::int4range
	WHEN val <@ '[0,15)'::int4range THEN '[0,15)'::int4range
	WHEN val <@ '[15,)'::int4range THEN '[15,)'::int4range
	ELSE NULL END AS ttl_bucket$$;

CREATE OR REPLACE FUNCTION de_bahnvorhersage.latest_sample_ttl_bucket_range(val int4range) RETURNS int4range
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$SELECT val as ttl_bucket$$;

CREATE OR REPLACE FUNCTION de_bahnvorhersage.response_type_name(val smallint) RETURNS text
    LANGUAGE sql
    AS $$SELECT key FROM
json_each('{
	"journeys": 0,
	"departures": 1,
	"arrivals": 2,
	"trip": 3,
	"refreshJourney": 4,
	"parquetFile": 20
}')
WHERE value::text = val::text$$;

--
-- Lookup tables
--

CREATE TABLE IF NOT EXISTS de_bahnvorhersage.load_factor (
    load_factor_id smallserial PRIMARY KEY,
    name text NOT NULL CONSTRAINT load_factor_name UNIQUE
);

CREATE TABLE IF NOT EXISTS de_bahnvorhersage.operator (
    operator_id smallserial PRIMARY KEY,
    id text NOT NULL CONSTRAINT operator_id UNIQUE,
    name text
);

CREATE TABLE IF NOT EXISTS de_bahnvorhersage.product_type (
    product_type_id smallserial PRIMARY KEY,
    name text NOT NULL CONSTRAINT product_type_name UNIQUE
);
-- same ids as de_db, so that results are directly comparable (cf. merge.sql)
INSERT INTO de_bahnvorhersage.product_type (product_type_id, name) VALUES
(1, 'bus'), (2, 'subway'), (3, 'tram'), (4, 'regional'), (5, 'suburban'),
(6, 'nationalExpress'), (7, 'national'), (8, 'regionalExpress'), (9, 'ferry'), (10, 'taxi')
ON CONFLICT DO NOTHING;
SELECT setval('de_bahnvorhersage.product_type_product_type_id_seq', GREATEST(10, (SELECT MAX(product_type_id) FROM de_bahnvorhersage.product_type)));

CREATE TABLE IF NOT EXISTS de_bahnvorhersage.prognosis_type (
    prognosis_type_id smallserial PRIMARY KEY,
    name text NOT NULL
);

CREATE TABLE IF NOT EXISTS de_bahnvorhersage.remarks (
    remarks_hash uuid PRIMARY KEY,
    remarks jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS de_bahnvorhersage.official_delay_stats (
    year smallint NOT NULL,
    month smallint NOT NULL,
    delay_percentage_5min real NOT NULL,
    delay_percentage_15min real NOT NULL,
    category text NOT NULL,
    CONSTRAINT pk PRIMARY KEY (year, month, category)
);

CREATE TABLE IF NOT EXISTS de_bahnvorhersage.official_delay_stats_operators (
    category text NOT NULL,
    operator text NOT NULL,
    CONSTRAINT official_delay_stats_operators_pk PRIMARY KEY (category, operator)
);

CREATE TABLE IF NOT EXISTS de_bahnvorhersage.station (
    station_id text NOT NULL CONSTRAINT station_id PRIMARY KEY,
    lonlat point NOT NULL,
    name text NOT NULL,
    parent text CONSTRAINT station_parent REFERENCES de_bahnvorhersage.station(station_id) DEFERRABLE INITIALLY DEFERRED,
    details jsonb
);
CREATE INDEX IF NOT EXISTS fki_parent ON de_bahnvorhersage.station USING btree (parent);

-- one row per ingested parquet file (hash = md5 of file name + size), used to skip already ingested files
CREATE TABLE IF NOT EXISTS de_bahnvorhersage.response_log (
    response_id serial PRIMARY KEY,
    hash uuid NOT NULL CONSTRAINT hash UNIQUE,
    type smallint NOT NULL,
    response_time timestamp with time zone NOT NULL,
    source smallint NOT NULL,
    sample_count integer NOT NULL,
    response_time_estimated boolean NOT NULL,
    sample_time_estimated boolean NOT NULL,
    ctrs jsonb NOT NULL
);

--
-- Raw samples (transient: aggregated and deleted by refresh_histograms_and_cleanup_samples)
--

CREATE UNLOGGED SEQUENCE IF NOT EXISTS de_bahnvorhersage.sample_id_seq;

CREATE UNLOGGED TABLE IF NOT EXISTS de_bahnvorhersage.sample (
    id bigint NOT NULL DEFAULT nextval('de_bahnvorhersage.sample_id_seq'::regclass) CONSTRAINT temp_sample_pkey PRIMARY KEY,
    scheduled_time timestamp with time zone NOT NULL,
    scheduled_duration_minutes smallint,
    projected_duration_minutes smallint,
    delay_minutes smallint,
    cancelled boolean NOT NULL,
    sample_time timestamp with time zone NOT NULL,
    ttl_minutes smallint NOT NULL,
    trip_id text NOT NULL,
    line_name text,
    line_fahrtnr text,
    product_type_id smallint,
    product_name text,
    station_id text NOT NULL,
    operator_id smallint,
    is_departure boolean NOT NULL,
    remarks_hash uuid,
    stop_number smallint,
    load_factor_id smallint,
    response_id integer,
    prognosis_type_id smallint
);
ALTER SEQUENCE de_bahnvorhersage.sample_id_seq OWNED BY de_bahnvorhersage.sample.id;

COMMENT ON COLUMN de_bahnvorhersage.sample.id IS 'autoincrement id';
COMMENT ON COLUMN de_bahnvorhersage.sample.scheduled_time IS 'parquet time_schedule';
COMMENT ON COLUMN de_bahnvorhersage.sample.delay_minutes IS 'parquet delay/60. NULL when cancelled. Note: 0 (not NULL) when no realtime data available yet.';
COMMENT ON COLUMN de_bahnvorhersage.sample.cancelled IS 'parquet is_cancelled';
COMMENT ON COLUMN de_bahnvorhersage.sample.sample_time IS 'parquet update_timestamp';
COMMENT ON COLUMN de_bahnvorhersage.sample.ttl_minutes IS 'time_real - update_timestamp. Positive when arrival/departure was in the future at sample time.';
COMMENT ON COLUMN de_bahnvorhersage.sample.trip_id IS 'parquet trip_id (hash)';
COMMENT ON COLUMN de_bahnvorhersage.sample.line_name IS 'derived from parquet category/line/number, e.g. "ICE 17", "RE 5", "S 2"';
COMMENT ON COLUMN de_bahnvorhersage.sample.line_fahrtnr IS 'parquet number';
COMMENT ON COLUMN de_bahnvorhersage.sample.product_type_id IS 'FK product_type, derived from parquet category/line/is_regional';
COMMENT ON COLUMN de_bahnvorhersage.sample.product_name IS 'parquet category';
COMMENT ON COLUMN de_bahnvorhersage.sample.station_id IS 'EVA number (parquet stop_id)';
COMMENT ON COLUMN de_bahnvorhersage.sample.operator_id IS 'FK operator (parquet operator code)';
COMMENT ON COLUMN de_bahnvorhersage.sample.is_departure IS 'NOT parquet is_arrival';
COMMENT ON COLUMN de_bahnvorhersage.sample.stop_number IS 'parquet stop_sequence';
COMMENT ON COLUMN de_bahnvorhersage.sample.response_id IS 'FK response_log (ingested parquet file)';

--
-- Histograms
--

CREATE TABLE IF NOT EXISTS de_bahnvorhersage.sample_histogram_by_day (
    scheduled_time timestamp with time zone,
    product_type_id smallint,
    operator_id smallint,
    is_departure boolean,
    prior_ttl_bucket int4range,
    prior_delay_bucket int4range,
    latest_sample_ttl_bucket int4range,
    latest_sample_delay_bucket int4range,
    sample_count numeric
);

CREATE TABLE IF NOT EXISTS de_bahnvorhersage.sample_histogram_by_duration (
    product_type_id smallint,
    is_departure boolean,
    prior_ttl_bucket int4range,
    prior_delay_bucket int4range,
    prior_scheduled_duration_bucket int4range,
    prior_projected_duration_bucket int4range,
    latest_sample_ttl_bucket int4range,
    latest_sample_delay_bucket int4range,
    latest_sample_duration_bucket int4range,
    sample_count numeric
);

CREATE TABLE IF NOT EXISTS de_bahnvorhersage.sample_histogram_by_hour (
    day_of_week smallint,
    hour smallint,
    product_type_id smallint,
    operator_id smallint,
    is_departure boolean,
    load_factor_id smallint,
    prior_ttl_bucket int4range,
    prior_delay_bucket int4range,
    latest_sample_ttl_bucket int4range,
    latest_sample_delay_bucket int4range,
    sample_count numeric
);

CREATE TABLE IF NOT EXISTS de_bahnvorhersage.sample_histogram_by_month (
    year smallint,
    month smallint,
    product_type_id smallint,
    operator_id smallint,
    is_departure boolean,
    prior_ttl_bucket int4range,
    prior_delay_bucket int4range,
    latest_sample_ttl_bucket int4range,
    latest_sample_delay_bucket int4range,
    sample_count numeric
);

-- only final delays (prior_ttl_bucket/prior_delay_bucket always NULL)
CREATE TABLE IF NOT EXISTS de_bahnvorhersage.sample_histogram_by_station (
    line_name text,
    product_type_id smallint,
    station_id text,
    operator_id smallint,
    is_departure boolean,
    load_factor_id smallint,
    prior_ttl_bucket int4range,
    prior_delay_bucket int4range,
    latest_sample_ttl_bucket int4range,
    latest_sample_delay_bucket int4range,
    sample_count numeric
);

CREATE TABLE IF NOT EXISTS de_bahnvorhersage.sample_histogram_without_time (
    product_type_id smallint,
    operator_id smallint,
    is_departure boolean,
    prior_ttl_bucket int4range,
    prior_delay_bucket int4range,
    latest_sample_ttl_bucket int4range,
    latest_sample_delay_bucket int4range,
    sample_count numeric
);

--
-- Aggregation procedures
--

CREATE OR REPLACE PROCEDURE de_bahnvorhersage.refresh_histograms_and_cleanup_samples(freeze_interval interval DEFAULT interval '2 days')
    LANGUAGE plpgsql
    AS $$begin
CREATE TEMP TABLE temp_freeze_threshold AS SELECT date_trunc('hour'::text, MAX(scheduled_time)-freeze_interval) scheduled_time FROM de_bahnvorhersage.sample;

CREATE TEMP TABLE temp_latest_sample AS
SELECT DISTINCT ON (s.trip_id, s.scheduled_time, s.station_id, s.is_departure) s.trip_id,
    s.scheduled_time,
    s.station_id,
    s.is_departure,
    s.ttl_minutes,
    s.id,
    s.sample_time,
        CASE
            WHEN s.cancelled THEN NULL::smallint
            ELSE s.delay_minutes
        END AS delay_minutes,
    s.projected_duration_minutes,
        CASE
            WHEN s.cancelled THEN false
            ELSE NULL::boolean
        END AS cancelled_with_substitute,
    s.line_name,
    s.product_type_id,
    s.operator_id,
    s.load_factor_id
   FROM de_bahnvorhersage.sample s
  WHERE (s.delay_minutes IS NOT NULL OR s.cancelled) AND s.scheduled_time < (SELECT scheduled_time FROM temp_freeze_threshold)
  ORDER BY s.trip_id, s.scheduled_time, s.station_id, s.is_departure, s.sample_time DESC, s.ttl_minutes;

CREATE TEMP TABLE temp_sample_histogram AS
SELECT date_trunc('hour'::text, s.scheduled_time) AS scheduled_time,
    s.product_type_id,
        -- operator only for final delays (prior_ttl_bucket IS NULL) to reduce volume by ~4x
        CASE
            WHEN latest_sample.id = s.id THEN s.operator_id
            ELSE NULL::smallint
        END AS operator_id,
    s.is_departure,
    s.load_factor_id,
        CASE
            WHEN latest_sample.id = s.id THEN NULL::int4range
            ELSE de_bahnvorhersage.ttl_bucket_range(s.ttl_minutes)
        END AS prior_ttl_bucket,
        CASE
            WHEN latest_sample.id = s.id THEN NULL::int4range
            ELSE de_bahnvorhersage.delay_bucket_range(s.delay_minutes)
        END AS prior_delay_bucket,
    de_bahnvorhersage.delay_bucket_range(s.scheduled_duration_minutes) AS prior_scheduled_duration_bucket,
        CASE
            WHEN latest_sample.id = s.id THEN NULL::int4range
            ELSE de_bahnvorhersage.delay_bucket_range(s.projected_duration_minutes)
        END AS prior_projected_duration_bucket,
    de_bahnvorhersage.ttl_bucket_range(latest_sample.ttl_minutes) AS latest_sample_ttl_bucket,
        CASE
            WHEN latest_sample.cancelled_with_substitute = true THEN '(,)'::int4range
            WHEN latest_sample.id = s.id OR s.delay_minutes IS NULL THEN de_bahnvorhersage.delay_bucket_range(latest_sample.delay_minutes)
            ELSE de_bahnvorhersage.delay_bucket_range(latest_sample.delay_minutes - s.delay_minutes)
        END AS latest_sample_delay_bucket,
        CASE
            WHEN latest_sample.cancelled_with_substitute = true THEN '(,)'::int4range
            WHEN latest_sample.id = s.id OR s.projected_duration_minutes IS NULL THEN de_bahnvorhersage.delay_bucket_range(latest_sample.projected_duration_minutes)
            ELSE de_bahnvorhersage.delay_bucket_range(latest_sample.projected_duration_minutes - s.projected_duration_minutes)
        END AS latest_sample_duration_bucket,
    COUNT(*) AS sample_count
   FROM de_bahnvorhersage.sample s
     JOIN temp_latest_sample latest_sample ON s.trip_id = latest_sample.trip_id AND s.scheduled_time = latest_sample.scheduled_time AND s.station_id = latest_sample.station_id AND s.is_departure = latest_sample.is_departure
  WHERE s.scheduled_time < (SELECT scheduled_time FROM temp_freeze_threshold) AND (NOT s.cancelled OR latest_sample.id = s.id)
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12;


CREATE TABLE de_bahnvorhersage.temp_sample_histogram_by_hour (LIKE de_bahnvorhersage.sample_histogram_by_hour INCLUDING ALL);

INSERT INTO de_bahnvorhersage.temp_sample_histogram_by_hour (day_of_week, hour, product_type_id, operator_id, is_departure, load_factor_id, prior_ttl_bucket, prior_delay_bucket, latest_sample_ttl_bucket, latest_sample_delay_bucket, sample_count)
SELECT day_of_week, hour, product_type_id, operator_id, is_departure, load_factor_id, prior_ttl_bucket, prior_delay_bucket, latest_sample_ttl_bucket, latest_sample_delay_bucket,
sum(sample_count) AS sample_count
FROM
(
SELECT
    date_part('dow', scheduled_time)::smallint AS day_of_week,
    date_part('hour', scheduled_time)::smallint AS hour,
    product_type_id,
    operator_id,
    is_departure,
    load_factor_id,
    prior_ttl_bucket,
    prior_delay_bucket,
    de_bahnvorhersage.latest_sample_ttl_bucket_range(latest_sample_ttl_bucket) AS latest_sample_ttl_bucket,
    latest_sample_delay_bucket,
    sum(sample_count) AS sample_count
FROM temp_sample_histogram
GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10
UNION ALL
SELECT day_of_week, hour, product_type_id, operator_id, is_departure, load_factor_id, prior_ttl_bucket, prior_delay_bucket, latest_sample_ttl_bucket, latest_sample_delay_bucket, sample_count
FROM de_bahnvorhersage.sample_histogram_by_hour
) AS t
GROUP BY day_of_week, hour, product_type_id, operator_id, is_departure, load_factor_id, prior_ttl_bucket, prior_delay_bucket, latest_sample_ttl_bucket, latest_sample_delay_bucket;

DROP TABLE de_bahnvorhersage.sample_histogram_by_hour;
ALTER TABLE de_bahnvorhersage.temp_sample_histogram_by_hour RENAME TO sample_histogram_by_hour;


CREATE TABLE de_bahnvorhersage.temp_sample_histogram_by_day (LIKE de_bahnvorhersage.sample_histogram_by_day INCLUDING ALL);

INSERT INTO de_bahnvorhersage.temp_sample_histogram_by_day (scheduled_time, product_type_id, operator_id, is_departure, prior_ttl_bucket, prior_delay_bucket, latest_sample_ttl_bucket, latest_sample_delay_bucket, sample_count)
SELECT scheduled_time, product_type_id, operator_id, is_departure, prior_ttl_bucket, prior_delay_bucket, latest_sample_ttl_bucket, latest_sample_delay_bucket,
sum(sample_count) AS sample_count
FROM
(
SELECT
    date_trunc('day'::text, scheduled_time) AS scheduled_time,
    product_type_id,
    operator_id,
    is_departure,
    prior_ttl_bucket,
    prior_delay_bucket,
    de_bahnvorhersage.latest_sample_ttl_bucket_range(latest_sample_ttl_bucket) AS latest_sample_ttl_bucket,
    latest_sample_delay_bucket,
    sum(sample_count) AS sample_count
FROM temp_sample_histogram
GROUP BY 1, 2, 3, 4, 5, 6, 7, 8
UNION ALL
SELECT scheduled_time, product_type_id, operator_id, is_departure, prior_ttl_bucket, prior_delay_bucket, latest_sample_ttl_bucket, latest_sample_delay_bucket, sample_count
FROM de_bahnvorhersage.sample_histogram_by_day
) AS t
GROUP BY scheduled_time, product_type_id, operator_id, is_departure, prior_ttl_bucket, prior_delay_bucket, latest_sample_ttl_bucket, latest_sample_delay_bucket;

DROP TABLE de_bahnvorhersage.sample_histogram_by_day;
ALTER TABLE de_bahnvorhersage.temp_sample_histogram_by_day RENAME TO sample_histogram_by_day;


CREATE TABLE de_bahnvorhersage.temp_sample_histogram_by_station (LIKE de_bahnvorhersage.sample_histogram_by_station INCLUDING ALL);

INSERT INTO de_bahnvorhersage.temp_sample_histogram_by_station (line_name, product_type_id, station_id, operator_id, is_departure, load_factor_id, prior_ttl_bucket, prior_delay_bucket, latest_sample_ttl_bucket, latest_sample_delay_bucket, sample_count)
SELECT line_name, product_type_id, station_id, operator_id, is_departure, load_factor_id, prior_ttl_bucket, prior_delay_bucket, latest_sample_ttl_bucket, latest_sample_delay_bucket,
sum(sample_count) AS sample_count
FROM
(
SELECT
    line_name,
    product_type_id,
    station_id,
    operator_id,
    is_departure,
    load_factor_id,
    NULL::int4range AS prior_ttl_bucket,
    NULL::int4range AS prior_delay_bucket,
    de_bahnvorhersage.latest_sample_ttl_bucket_range(de_bahnvorhersage.ttl_bucket_range(ttl_minutes)) AS latest_sample_ttl_bucket,
        CASE
            WHEN cancelled_with_substitute = true THEN '(,)'::int4range
            ELSE de_bahnvorhersage.delay_bucket_range(delay_minutes)
        END AS latest_sample_delay_bucket,
    count(*) AS sample_count
FROM temp_latest_sample
GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10
UNION ALL
SELECT line_name, product_type_id, station_id, operator_id, is_departure, load_factor_id, prior_ttl_bucket, prior_delay_bucket, latest_sample_ttl_bucket, latest_sample_delay_bucket, sample_count
FROM de_bahnvorhersage.sample_histogram_by_station
) AS t
GROUP BY line_name, product_type_id, station_id, operator_id, is_departure, load_factor_id, prior_ttl_bucket, prior_delay_bucket, latest_sample_ttl_bucket, latest_sample_delay_bucket;

DROP TABLE de_bahnvorhersage.sample_histogram_by_station;
ALTER TABLE de_bahnvorhersage.temp_sample_histogram_by_station RENAME TO sample_histogram_by_station;


CREATE TABLE de_bahnvorhersage.temp_sample_histogram_by_duration (LIKE de_bahnvorhersage.sample_histogram_by_duration INCLUDING ALL);

INSERT INTO de_bahnvorhersage.temp_sample_histogram_by_duration (product_type_id, is_departure, prior_ttl_bucket, prior_delay_bucket, prior_scheduled_duration_bucket, prior_projected_duration_bucket, latest_sample_ttl_bucket, latest_sample_delay_bucket, latest_sample_duration_bucket, sample_count)
SELECT product_type_id, is_departure, prior_ttl_bucket, prior_delay_bucket, prior_scheduled_duration_bucket, prior_projected_duration_bucket, latest_sample_ttl_bucket, latest_sample_delay_bucket, latest_sample_duration_bucket,
sum(sample_count) AS sample_count
FROM
(
SELECT product_type_id, is_departure, prior_ttl_bucket, prior_delay_bucket, prior_scheduled_duration_bucket, prior_projected_duration_bucket, latest_sample_ttl_bucket, latest_sample_delay_bucket, latest_sample_duration_bucket,
    sum(sample_count) AS sample_count
FROM temp_sample_histogram
GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9
UNION ALL
SELECT product_type_id, is_departure, prior_ttl_bucket, prior_delay_bucket, prior_scheduled_duration_bucket, prior_projected_duration_bucket, latest_sample_ttl_bucket, latest_sample_delay_bucket, latest_sample_duration_bucket, sample_count
FROM de_bahnvorhersage.sample_histogram_by_duration
) AS t
GROUP BY product_type_id, is_departure, prior_ttl_bucket, prior_delay_bucket, prior_scheduled_duration_bucket, prior_projected_duration_bucket, latest_sample_ttl_bucket, latest_sample_delay_bucket, latest_sample_duration_bucket;

DROP TABLE de_bahnvorhersage.sample_histogram_by_duration;
ALTER TABLE de_bahnvorhersage.temp_sample_histogram_by_duration RENAME TO sample_histogram_by_duration;


DROP TABLE temp_sample_histogram;
DROP TABLE temp_latest_sample;

-- keep only unfrozen samples. sample is UNLOGGED (transient raw data), so we recreate it as such.
CREATE UNLOGGED TABLE de_bahnvorhersage.temp_sample (LIKE de_bahnvorhersage.sample INCLUDING ALL);

INSERT INTO de_bahnvorhersage.temp_sample
SELECT * FROM de_bahnvorhersage.sample WHERE scheduled_time >= (SELECT scheduled_time FROM temp_freeze_threshold);

ALTER SEQUENCE de_bahnvorhersage.sample_id_seq OWNED BY de_bahnvorhersage.temp_sample.id;
DROP TABLE de_bahnvorhersage.sample;
ALTER TABLE de_bahnvorhersage.temp_sample RENAME TO sample;

DROP TABLE temp_freeze_threshold;

GRANT SELECT ON TABLE de_bahnvorhersage.sample TO "public-transport-stats-read";
GRANT SELECT ON TABLE de_bahnvorhersage.sample_histogram_by_day TO "public-transport-stats-read";
GRANT SELECT ON TABLE de_bahnvorhersage.sample_histogram_by_duration TO "public-transport-stats-read";
GRANT SELECT ON TABLE de_bahnvorhersage.sample_histogram_by_hour TO "public-transport-stats-read";
GRANT SELECT ON TABLE de_bahnvorhersage.sample_histogram_by_station TO "public-transport-stats-read";

end$$;


CREATE OR REPLACE PROCEDURE de_bahnvorhersage.refresh_histograms_aggregations()
    LANGUAGE sql
    AS $$TRUNCATE TABLE de_bahnvorhersage.sample_histogram_without_time;
INSERT INTO de_bahnvorhersage.sample_histogram_without_time
SELECT sample_histogram.product_type_id,
    sample_histogram.operator_id,
    sample_histogram.is_departure,
    sample_histogram.prior_ttl_bucket,
    sample_histogram.prior_delay_bucket,
    sample_histogram.latest_sample_ttl_bucket,
    sample_histogram.latest_sample_delay_bucket,
    sum(sample_histogram.sample_count) AS sample_count
FROM de_bahnvorhersage.sample_histogram_by_day sample_histogram
GROUP BY sample_histogram.product_type_id, sample_histogram.operator_id, sample_histogram.is_departure, sample_histogram.prior_delay_bucket, sample_histogram.prior_ttl_bucket, sample_histogram.latest_sample_delay_bucket, sample_histogram.latest_sample_ttl_bucket;

TRUNCATE TABLE de_bahnvorhersage.sample_histogram_by_month;
INSERT INTO de_bahnvorhersage.sample_histogram_by_month
SELECT date_part('year'::text, sample_histogram.scheduled_time)::smallint AS year,
    date_part('month'::text, sample_histogram.scheduled_time)::smallint AS month,
    sample_histogram.product_type_id,
    sample_histogram.operator_id,
    sample_histogram.is_departure,
    sample_histogram.prior_ttl_bucket,
    sample_histogram.prior_delay_bucket,
    sample_histogram.latest_sample_ttl_bucket,
    sample_histogram.latest_sample_delay_bucket,
    sum(sample_histogram.sample_count) AS sample_count
FROM de_bahnvorhersage.sample_histogram_by_day sample_histogram
GROUP BY (date_part('year'::text, sample_histogram.scheduled_time)::smallint), (date_part('month'::text, sample_histogram.scheduled_time)::smallint), sample_histogram.product_type_id, sample_histogram.operator_id, sample_histogram.is_departure, sample_histogram.prior_delay_bucket, sample_histogram.prior_ttl_bucket, sample_histogram.latest_sample_delay_bucket, sample_histogram.latest_sample_ttl_bucket;$$;

--
-- Permissions
--

GRANT USAGE ON SCHEMA de_bahnvorhersage TO "public-transport-stats-read";
GRANT SELECT ON ALL TABLES IN SCHEMA de_bahnvorhersage TO "public-transport-stats-read";
GRANT SELECT ON ALL SEQUENCES IN SCHEMA de_bahnvorhersage TO "public-transport-stats-read";
ALTER DEFAULT PRIVILEGES IN SCHEMA de_bahnvorhersage GRANT SELECT ON TABLES TO "public-transport-stats-read";
ALTER DEFAULT PRIVILEGES IN SCHEMA de_bahnvorhersage GRANT SELECT ON SEQUENCES TO "public-transport-stats-read";
