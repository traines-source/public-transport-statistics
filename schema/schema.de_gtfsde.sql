--
-- PostgreSQL database dump
--

-- Dumped from database version 15.1 (Debian 15.1-1.pgdg110+1)
-- Dumped by pg_dump version 15.1 (Debian 15.1-1.pgdg110+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: de_gtfsde; Type: SCHEMA; Schema: -; Owner: public-transport-stats
--

CREATE SCHEMA de_gtfsde;


ALTER SCHEMA de_gtfsde OWNER TO "public-transport-stats";

--
-- Name: delay_bucket_range(smallint); Type: FUNCTION; Schema: de_gtfsde; Owner: public-transport-stats
--

CREATE FUNCTION de_gtfsde.delay_bucket_range(val smallint) RETURNS int4range
    LANGUAGE sql
    AS $$SELECT
CAST(
	CASE 	
	WHEN val < -90 THEN '(,-90)'
	WHEN val < -75 THEN '[-90,-75)'
	WHEN val < -60 THEN '[-75,-60)'
	WHEN val < -45 THEN '[-60,-45)'
	WHEN val < -30 THEN '[-45,-30)'
	WHEN val < -25 THEN '[-30,-25)'
	WHEN val < -20 THEN '[-25,-20)'
	WHEN val < -15 THEN '[-20,-15)'
	WHEN val < -10 THEN '[-15,-10)'
	WHEN val < -9 THEN '[-10,-9)'
	WHEN val < -8 THEN '[-9,-8)'
	WHEN val < -7 THEN '[-8,-7)'
	WHEN val < -6 THEN '[-7,-6)'
	WHEN val < -5 THEN '[-6,-5)'
	WHEN val < -4 THEN '[-5,-4)'
	WHEN val < -3 THEN '[-4,-3)'
	WHEN val < -2 THEN '[-3,-2)'
	WHEN val < -1 THEN '[-2,-1)'
	WHEN val < 0 THEN '[-1,0)'
	WHEN val < 1 THEN '[0,1)'
	WHEN val < 2 THEN '[1,2)'
	WHEN val < 3 THEN '[2,3)'
	WHEN val < 4 THEN '[3,4)'
	WHEN val < 5 THEN '[4,5)'
	WHEN val < 6 THEN '[5,6)'
	WHEN val < 7 THEN '[6,7)'
	WHEN val < 8 THEN '[7,8)'
	WHEN val < 9 THEN '[8,9)'
	WHEN val < 10 THEN '[9,10)'
	WHEN val < 11 THEN '[10,11)'
	WHEN val < 16 THEN '[11,16)'
	WHEN val < 21 THEN '[16,21)'
	WHEN val < 26 THEN '[21,26)'
	WHEN val < 31 THEN '[26,31)'
	WHEN val < 46 THEN '[31,46)'
	WHEN val < 61 THEN '[46,61)'
	WHEN val < 76 THEN '[61,76)'
	WHEN val < 91 THEN '[76,91)'
	WHEN val >= 91 THEN '[91,)'
	ELSE NULL END
	AS int4range
) AS delay_bucket$$;


ALTER FUNCTION de_gtfsde.delay_bucket_range(val smallint) OWNER TO "public-transport-stats";

--
-- Name: reduced_latest_sample_ttl_bucket_range(int4range); Type: FUNCTION; Schema: de_gtfsde; Owner: public-transport-stats
--

CREATE FUNCTION de_gtfsde.reduced_latest_sample_ttl_bucket_range(val int4range) RETURNS int4range
    LANGUAGE sql
    AS $$SELECT
CAST(
	CASE
	WHEN val <@ '(,-15)'::int4range THEN '(,-15)'
	WHEN val <@ '[-15,0)'::int4range THEN '[-15,0)'
	WHEN val <@ '[0,15)'::int4range THEN '[0,15)'
	WHEN val <@ '[15,)'::int4range THEN '[15,)'
	ELSE NULL END
	AS int4range
) AS ttl_bucket$$;


ALTER FUNCTION de_gtfsde.reduced_latest_sample_ttl_bucket_range(val int4range) OWNER TO "public-transport-stats";

--
-- Name: refresh_histograms_aggregations(); Type: PROCEDURE; Schema: de_gtfsde; Owner: public-transport-stats
--

CREATE PROCEDURE de_gtfsde.refresh_histograms_aggregations()
    LANGUAGE sql
    AS $$TRUNCATE TABLE de_gtfsde.sample_histogram_without_time;
INSERT INTO de_gtfsde.sample_histogram_without_time
SELECT sample_histogram.product_type_id,
    sample_histogram.operator_id,
    sample_histogram.is_departure,
    sample_histogram.prior_ttl_bucket,
    sample_histogram.prior_delay_bucket,
    sample_histogram.latest_sample_ttl_bucket,
    sample_histogram.latest_sample_delay_bucket,
    sum(sample_histogram.sample_count) AS sample_count
FROM de_gtfsde.sample_histogram_by_day sample_histogram
GROUP BY sample_histogram.product_type_id, sample_histogram.operator_id, sample_histogram.is_departure, sample_histogram.prior_delay_bucket, sample_histogram.prior_ttl_bucket, sample_histogram.latest_sample_delay_bucket, sample_histogram.latest_sample_ttl_bucket;

TRUNCATE TABLE de_gtfsde.sample_histogram_by_month;
INSERT INTO de_gtfsde.sample_histogram_by_month
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
FROM de_gtfsde.sample_histogram_by_day sample_histogram
GROUP BY (date_part('year'::text, sample_histogram.scheduled_time)::smallint), (date_part('month'::text, sample_histogram.scheduled_time)::smallint), sample_histogram.product_type_id, sample_histogram.operator_id, sample_histogram.is_departure, sample_histogram.prior_delay_bucket, sample_histogram.prior_ttl_bucket, sample_histogram.latest_sample_delay_bucket, sample_histogram.latest_sample_ttl_bucket;$$;


ALTER PROCEDURE de_gtfsde.refresh_histograms_aggregations() OWNER TO "public-transport-stats";

--
-- Name: refresh_histograms_and_cleanup_samples(); Type: PROCEDURE; Schema: de_gtfsde; Owner: public-transport-stats
--

CREATE PROCEDURE de_gtfsde.refresh_histograms_and_cleanup_samples()
    LANGUAGE plpgsql
    AS $$begin
CREATE TEMP TABLE temp_freeze_threshold AS SELECT date_trunc('hour'::text, MAX(scheduled_time)-interval '2 days') scheduled_time FROM de_gtfsde.sample;

CREATE TEMP TABLE temp_sample_histogram AS
WITH latest_sample AS (	
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
        END AS cancelled_with_substitute
   FROM de_gtfsde.sample s
  WHERE s.delay_minutes IS NOT NULL OR s.cancelled
  ORDER BY s.trip_id, s.scheduled_time, s.station_id, s.is_departure, s.sample_time DESC, s.ttl_minutes
)
SELECT date_trunc('hour'::text, s.scheduled_time) as scheduled_time,
    NULL as line_name,
    s.product_type_id,
    NULL as station_id,
    NULL as operator_id,
    s.is_departure,
	s.load_factor_id,  
                CASE
                    WHEN latest_sample.id = s.id THEN NULL::int4range
                    ELSE de_gtfsde.ttl_bucket_range(s.ttl_minutes)
                END AS prior_ttl_bucket,
                CASE
                    WHEN latest_sample.id = s.id THEN NULL::int4range
                    ELSE de_gtfsde.delay_bucket_range(s.delay_minutes)
                END AS prior_delay_bucket,
			de_gtfsde.delay_bucket_range(s.scheduled_duration_minutes) AS prior_scheduled_duration_bucket,
				CASE
                    WHEN latest_sample.id = s.id THEN NULL::int4range
                    ELSE de_gtfsde.delay_bucket_range(s.projected_duration_minutes)
                END AS prior_projected_duration_bucket,
            de_gtfsde.ttl_bucket_range(latest_sample.ttl_minutes) AS latest_sample_ttl_bucket,
                CASE
                    WHEN latest_sample.cancelled_with_substitute = true THEN '(,)'::int4range
                    WHEN latest_sample.id = s.id OR s.delay_minutes IS NULL THEN de_gtfsde.delay_bucket_range(latest_sample.delay_minutes)
                    ELSE de_gtfsde.delay_bucket_range(latest_sample.delay_minutes - s.delay_minutes)
                END AS latest_sample_delay_bucket,
				CASE
                    WHEN latest_sample.cancelled_with_substitute = true THEN '(,)'::int4range
                    WHEN latest_sample.id = s.id OR s.projected_duration_minutes IS NULL THEN de_gtfsde.delay_bucket_range(latest_sample.projected_duration_minutes)
                    ELSE de_gtfsde.delay_bucket_range(latest_sample.projected_duration_minutes - s.projected_duration_minutes)
                END AS latest_sample_duration_bucket,
            COUNT(*) AS sample_count
           FROM de_gtfsde.sample s
             JOIN latest_sample ON s.trip_id = latest_sample.trip_id AND s.scheduled_time = latest_sample.scheduled_time AND s.station_id = latest_sample.station_id AND s.is_departure = latest_sample.is_departure
          WHERE s.scheduled_time < (SELECT scheduled_time FROM temp_freeze_threshold) AND (NOT s.cancelled OR latest_sample.id = s.id)
          GROUP BY date_trunc('hour'::text, s.scheduled_time), s.product_type_id, s.is_departure, s.load_factor_id, prior_ttl_bucket, prior_delay_bucket, prior_scheduled_duration_bucket, prior_projected_duration_bucket, latest_sample_ttl_bucket, latest_sample_delay_bucket, latest_sample_duration_bucket;



CREATE TABLE de_gtfsde.temp_sample_histogram_by_hour (LIKE de_gtfsde.sample_histogram_by_hour INCLUDING ALL);

INSERT INTO de_gtfsde.temp_sample_histogram_by_hour
SELECT day_of_week, hour, product_type_id, NULL as operator_id, is_departure, load_factor_id, prior_ttl_bucket, prior_delay_bucket, latest_sample_ttl_bucket, latest_sample_delay_bucket,
sum(sample_count) AS sample_count
FROM
(
SELECT
    date_part('dow', scheduled_time)::smallint AS day_of_week,
	date_part('hour', scheduled_time)::smallint AS hour,
    NULL as operator_id,
	product_type_id,
	is_departure,
	load_factor_id,
	prior_ttl_bucket,
	prior_delay_bucket,
	de_gtfsde.latest_sample_ttl_bucket_range(latest_sample_ttl_bucket) AS latest_sample_ttl_bucket,
	latest_sample_delay_bucket,
    sum(sample_count) AS sample_count
FROM temp_sample_histogram
GROUP BY date_part('dow', scheduled_time)::smallint, date_part('hour', scheduled_time)::smallint, product_type_id, is_departure, load_factor_id, prior_ttl_bucket, prior_delay_bucket, de_gtfsde.latest_sample_ttl_bucket_range(latest_sample_ttl_bucket), latest_sample_delay_bucket
UNION ALL
SELECT * FROM de_gtfsde.sample_histogram_by_hour
) AS t
GROUP BY day_of_week, hour, product_type_id, is_departure, load_factor_id, prior_ttl_bucket, prior_delay_bucket, latest_sample_ttl_bucket, latest_sample_delay_bucket;

ALTER TABLE de_gtfsde.temp_sample_histogram_by_hour OWNER TO "public-transport-stats";
DROP TABLE de_gtfsde.sample_histogram_by_hour;
ALTER TABLE de_gtfsde.temp_sample_histogram_by_hour RENAME TO sample_histogram_by_hour;


CREATE TABLE de_gtfsde.temp_sample_histogram_by_day (LIKE de_gtfsde.sample_histogram_by_day INCLUDING ALL);

INSERT INTO de_gtfsde.temp_sample_histogram_by_day
SELECT scheduled_time, product_type_id, NULL as operator_id, is_departure, prior_ttl_bucket, prior_delay_bucket, latest_sample_ttl_bucket, latest_sample_delay_bucket,
sum(sample_count) AS sample_count
FROM
(
SELECT
    date_trunc('day'::text, scheduled_time) AS scheduled_time,
	product_type_id,
    NULL as operator_id,
	is_departure,
	prior_ttl_bucket,
	prior_delay_bucket,
	de_gtfsde.latest_sample_ttl_bucket_range(latest_sample_ttl_bucket) AS latest_sample_ttl_bucket,
	latest_sample_delay_bucket,
    sum(sample_count) AS sample_count
FROM temp_sample_histogram
GROUP BY date_trunc('day'::text, scheduled_time), product_type_id, is_departure, prior_ttl_bucket, prior_delay_bucket, de_gtfsde.latest_sample_ttl_bucket_range(latest_sample_ttl_bucket), latest_sample_delay_bucket
UNION ALL
SELECT * FROM de_gtfsde.sample_histogram_by_day
) AS t
GROUP BY scheduled_time, product_type_id, is_departure, prior_ttl_bucket, prior_delay_bucket, latest_sample_ttl_bucket, latest_sample_delay_bucket;

ALTER TABLE de_gtfsde.temp_sample_histogram_by_day OWNER TO "public-transport-stats";
DROP TABLE de_gtfsde.sample_histogram_by_day;
ALTER TABLE de_gtfsde.temp_sample_histogram_by_day RENAME TO sample_histogram_by_day;

"""
CREATE TABLE de_gtfsde.temp_sample_histogram_by_station (LIKE de_gtfsde.sample_histogram_by_station INCLUDING ALL);

INSERT INTO de_gtfsde.temp_sample_histogram_by_station
SELECT line_name, product_type_id, NULL as station_id, NULL as operator_id, is_departure, load_factor_id, prior_ttl_bucket, prior_delay_bucket, latest_sample_ttl_bucket, latest_sample_delay_bucket,
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
	prior_ttl_bucket,
	prior_delay_bucket,
	de_gtfsde.latest_sample_ttl_bucket_range(latest_sample_ttl_bucket) AS latest_sample_ttl_bucket,
	latest_sample_delay_bucket,
    sum(sample_count) AS sample_count
FROM temp_sample_histogram
WHERE prior_ttl_bucket IS NULL
GROUP BY line_name, product_type_id, station_id, operator_id, is_departure, load_factor_id, prior_ttl_bucket, prior_delay_bucket, de_gtfsde.latest_sample_ttl_bucket_range(latest_sample_ttl_bucket), latest_sample_delay_bucket
UNION ALL
SELECT * FROM de_gtfsde.sample_histogram_by_station
) AS t
GROUP BY line_name, product_type_id, station_id, operator_id, is_departure, load_factor_id, prior_ttl_bucket, prior_delay_bucket, latest_sample_ttl_bucket, latest_sample_delay_bucket;

ALTER TABLE de_gtfsde.temp_sample_histogram_by_station OWNER TO "public-transport-stats";
DROP TABLE de_gtfsde.sample_histogram_by_station;
ALTER TABLE de_gtfsde.temp_sample_histogram_by_station RENAME TO sample_histogram_by_station;
"""

CREATE TABLE de_gtfsde.temp_sample_histogram_by_duration (LIKE de_gtfsde.sample_histogram_by_duration INCLUDING ALL);

INSERT INTO de_gtfsde.temp_sample_histogram_by_duration
SELECT product_type_id, is_departure, prior_ttl_bucket, prior_delay_bucket, prior_scheduled_duration_bucket, prior_projected_duration_bucket, latest_sample_ttl_bucket, latest_sample_delay_bucket, latest_sample_duration_bucket,
sum(sample_count) AS sample_count
FROM
(
SELECT
    product_type_id,
    is_departure,
    prior_ttl_bucket,
    prior_delay_bucket,
	prior_scheduled_duration_bucket,
	prior_projected_duration_bucket,
    latest_sample_ttl_bucket,
    latest_sample_delay_bucket,
	latest_sample_duration_bucket,
    sum(sample_count) AS sample_count
FROM temp_sample_histogram
GROUP BY product_type_id, is_departure, prior_ttl_bucket, prior_delay_bucket, prior_scheduled_duration_bucket, prior_projected_duration_bucket, latest_sample_ttl_bucket, latest_sample_delay_bucket, latest_sample_duration_bucket
UNION ALL
SELECT * FROM de_gtfsde.sample_histogram_by_duration
) AS t
GROUP BY product_type_id, is_departure, prior_ttl_bucket, prior_delay_bucket, prior_scheduled_duration_bucket, prior_projected_duration_bucket, latest_sample_ttl_bucket, latest_sample_delay_bucket, latest_sample_duration_bucket;

ALTER TABLE de_gtfsde.temp_sample_histogram_by_duration OWNER TO "public-transport-stats";
DROP TABLE de_gtfsde.sample_histogram_by_duration;
ALTER TABLE de_gtfsde.temp_sample_histogram_by_duration RENAME TO sample_histogram_by_duration;


DROP TABLE temp_sample_histogram;

CREATE TABLE de_gtfsde.temp_sample (LIKE de_gtfsde.sample INCLUDING ALL);

INSERT INTO de_gtfsde.temp_sample
SELECT * FROM de_gtfsde.sample WHERE scheduled_time >= (SELECT scheduled_time FROM temp_freeze_threshold);

ALTER TABLE de_gtfsde.temp_sample OWNER TO "public-transport-stats";
ALTER SEQUENCE de_gtfsde.sample_id_seq OWNED BY de_gtfsde.temp_sample.id;
DROP TABLE de_gtfsde.sample;
ALTER TABLE de_gtfsde.temp_sample RENAME TO sample;

DROP TABLE temp_freeze_threshold;



GRANT SELECT ON TABLE de_gtfsde.sample_histogram_by_day TO "public-transport-stats-read";
GRANT SELECT ON TABLE de_gtfsde.sample_histogram_by_duration TO "public-transport-stats-read";
GRANT SELECT ON TABLE de_gtfsde.sample_histogram_by_hour TO "public-transport-stats-read";
GRANT SELECT ON TABLE de_gtfsde.sample_histogram_by_station TO "public-transport-stats-read";



end$$;


ALTER PROCEDURE de_gtfsde.refresh_histograms_and_cleanup_samples() OWNER TO "public-transport-stats";

--
-- Name: response_type_name(smallint); Type: FUNCTION; Schema: de_gtfsde; Owner: public-transport-stats
--

CREATE FUNCTION de_gtfsde.response_type_name(val smallint) RETURNS text
    LANGUAGE sql
    AS $$SELECT key FROM
json_each('{
	    "journeys": 0,
        "departures": 1,
        "arrivals": 2,
        "trip": 3,
        "refreshJourney": 4
}')
WHERE value::text = val::text$$;


ALTER FUNCTION de_gtfsde.response_type_name(val smallint) OWNER TO "public-transport-stats";

--
-- Name: ttl_bucket_range(smallint); Type: FUNCTION; Schema: de_gtfsde; Owner: public-transport-stats
--

CREATE FUNCTION de_gtfsde.ttl_bucket_range(val smallint) RETURNS int4range
    LANGUAGE sql
    AS $$SELECT
CAST(
	CASE
	WHEN val < -20 THEN '(,-20)'
	WHEN val < -15 THEN '[-20,-15)'
	WHEN val < -10 THEN '[-15,-10)'
	WHEN val < -5 THEN '[-10,-5)'
	WHEN val < 0 THEN '[-5,0)'
	WHEN val < 5 THEN '[0,5)'
	WHEN val < 10 THEN '[5,10)'
	WHEN val < 15 THEN '[10,15)'
	WHEN val < 20 THEN '[15,20)'
	WHEN val < 25 THEN '[20,25)'
	WHEN val < 30 THEN '[25,30)'
	WHEN val < 45 THEN '[30,45)'
	WHEN val < 60 THEN '[45,60)'
	WHEN val < 75 THEN '[60,75)'
	WHEN val < 90 THEN '[75,90)'
	WHEN val < 120 THEN '[90,120)'
	WHEN val < 150 THEN '[120,150)'
	WHEN val < 180 THEN '[150,180)'
	WHEN val < 240 THEN '[180,240)'
	WHEN val < 300 THEN '[240,300)'
	WHEN val < 360 THEN '[300,360)'
	WHEN val >= 360 THEN '[360,)'
	ELSE NULL END
	AS int4range
) AS ttl_bucket$$;


ALTER FUNCTION de_gtfsde.ttl_bucket_range(val smallint) OWNER TO "public-transport-stats";

CREATE FUNCTION de_gtfsde.latest_sample_ttl_bucket_range(val int4range) RETURNS int4range
    LANGUAGE sql
    AS $$SELECT val as ttl_bucket$$;

ALTER FUNCTION de_gtfsde.latest_sample_ttl_bucket_range(val int4range) OWNER TO "public-transport-stats";

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: load_factor; Type: TABLE; Schema: de_gtfsde; Owner: public-transport-stats
--

CREATE TABLE de_gtfsde.load_factor (
    load_factor_id smallint NOT NULL,
    name text NOT NULL
);


ALTER TABLE de_gtfsde.load_factor OWNER TO "public-transport-stats";

--
-- Name: load_factor_load_factor_id_seq; Type: SEQUENCE; Schema: de_gtfsde; Owner: public-transport-stats
--

CREATE SEQUENCE de_gtfsde.load_factor_load_factor_id_seq
    AS smallint
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE de_gtfsde.load_factor_load_factor_id_seq OWNER TO "public-transport-stats";

--
-- Name: load_factor_load_factor_id_seq; Type: SEQUENCE OWNED BY; Schema: de_gtfsde; Owner: public-transport-stats
--

ALTER SEQUENCE de_gtfsde.load_factor_load_factor_id_seq OWNED BY de_gtfsde.load_factor.load_factor_id;


--
-- Name: official_delay_stats; Type: TABLE; Schema: de_gtfsde; Owner: public-transport-stats
--

CREATE TABLE de_gtfsde.official_delay_stats (
    year smallint NOT NULL,
    month smallint NOT NULL,
    delay_percentage_5min real NOT NULL,
    delay_percentage_15min real NOT NULL,
    category text NOT NULL
);


ALTER TABLE de_gtfsde.official_delay_stats OWNER TO "public-transport-stats";

--
-- Name: official_delay_stats_operators; Type: TABLE; Schema: de_gtfsde; Owner: public-transport-stats
--

CREATE TABLE de_gtfsde.official_delay_stats_operators (
    category text NOT NULL,
    operator text NOT NULL
);


ALTER TABLE de_gtfsde.official_delay_stats_operators OWNER TO "public-transport-stats";

--
-- Name: operator; Type: TABLE; Schema: de_gtfsde; Owner: public-transport-stats
--

CREATE TABLE de_gtfsde.operator (
    operator_id smallint NOT NULL,
    id text NOT NULL,
    name text
);


ALTER TABLE de_gtfsde.operator OWNER TO "public-transport-stats";

--
-- Name: operator_operator_id_seq; Type: SEQUENCE; Schema: de_gtfsde; Owner: public-transport-stats
--

CREATE SEQUENCE de_gtfsde.operator_operator_id_seq
    AS smallint
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE de_gtfsde.operator_operator_id_seq OWNER TO "public-transport-stats";

--
-- Name: operator_operator_id_seq; Type: SEQUENCE OWNED BY; Schema: de_gtfsde; Owner: public-transport-stats
--

ALTER SEQUENCE de_gtfsde.operator_operator_id_seq OWNED BY de_gtfsde.operator.operator_id;


--
-- Name: product_type; Type: TABLE; Schema: de_gtfsde; Owner: public-transport-stats
--

CREATE TABLE de_gtfsde.product_type (
    product_type_id smallint NOT NULL,
    name text NOT NULL
);


ALTER TABLE de_gtfsde.product_type OWNER TO "public-transport-stats";

--
-- Name: product_type_product_type_id_seq; Type: SEQUENCE; Schema: de_gtfsde; Owner: public-transport-stats
--

CREATE SEQUENCE de_gtfsde.product_type_product_type_id_seq
    AS smallint
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE de_gtfsde.product_type_product_type_id_seq OWNER TO "public-transport-stats";

--
-- Name: product_type_product_type_id_seq; Type: SEQUENCE OWNED BY; Schema: de_gtfsde; Owner: public-transport-stats
--

ALTER SEQUENCE de_gtfsde.product_type_product_type_id_seq OWNED BY de_gtfsde.product_type.product_type_id;


--
-- Name: prognosis_type; Type: TABLE; Schema: de_gtfsde; Owner: public-transport-stats
--

CREATE TABLE de_gtfsde.prognosis_type (
    prognosis_type_id smallint NOT NULL,
    name text NOT NULL
);


ALTER TABLE de_gtfsde.prognosis_type OWNER TO "public-transport-stats";

--
-- Name: prognosis_type_prognosis_type_id_seq; Type: SEQUENCE; Schema: de_gtfsde; Owner: public-transport-stats
--

CREATE SEQUENCE de_gtfsde.prognosis_type_prognosis_type_id_seq
    AS smallint
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE de_gtfsde.prognosis_type_prognosis_type_id_seq OWNER TO "public-transport-stats";

--
-- Name: prognosis_type_prognosis_type_id_seq; Type: SEQUENCE OWNED BY; Schema: de_gtfsde; Owner: public-transport-stats
--

ALTER SEQUENCE de_gtfsde.prognosis_type_prognosis_type_id_seq OWNED BY de_gtfsde.prognosis_type.prognosis_type_id;


--
-- Name: remarks; Type: TABLE; Schema: de_gtfsde; Owner: public-transport-stats
--

CREATE TABLE de_gtfsde.remarks (
    remarks_hash uuid NOT NULL,
    remarks jsonb NOT NULL
);


ALTER TABLE de_gtfsde.remarks OWNER TO "public-transport-stats";

--
-- Name: response_log; Type: TABLE; Schema: de_gtfsde; Owner: public-transport-stats
--

CREATE TABLE de_gtfsde.response_log (
    response_id integer NOT NULL,
    hash uuid NOT NULL,
    type smallint NOT NULL,
    response_time timestamp with time zone NOT NULL,
    source smallint NOT NULL,
    sample_count integer NOT NULL,
    response_time_estimated boolean NOT NULL,
    sample_time_estimated boolean NOT NULL,
    ctrs jsonb NOT NULL
);


ALTER TABLE de_gtfsde.response_log OWNER TO "public-transport-stats";

--
-- Name: response_log_response_id_seq; Type: SEQUENCE; Schema: de_gtfsde; Owner: public-transport-stats
--

CREATE SEQUENCE de_gtfsde.response_log_response_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE de_gtfsde.response_log_response_id_seq OWNER TO "public-transport-stats";

--
-- Name: response_log_response_id_seq; Type: SEQUENCE OWNED BY; Schema: de_gtfsde; Owner: public-transport-stats
--

ALTER SEQUENCE de_gtfsde.response_log_response_id_seq OWNED BY de_gtfsde.response_log.response_id;


--
-- Name: sample; Type: TABLE; Schema: de_gtfsde; Owner: public-transport-stats
--

CREATE TABLE de_gtfsde.sample (
    id bigint NOT NULL,
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


ALTER TABLE de_gtfsde.sample OWNER TO "public-transport-stats";

--
-- Name: COLUMN sample.id; Type: COMMENT; Schema: de_gtfsde; Owner: public-transport-stats
--

COMMENT ON COLUMN de_gtfsde.sample.id IS 'autoincrement id';


--
-- Name: COLUMN sample.scheduled_time; Type: COMMENT; Schema: de_gtfsde; Owner: public-transport-stats
--

COMMENT ON COLUMN de_gtfsde.sample.scheduled_time IS 'FPTF plannedWhen/plannedDrrival/plannedDeparture, time when arrival/departure was originally scheduled';


--
-- Name: COLUMN sample.delay_minutes; Type: COMMENT; Schema: de_gtfsde; Owner: public-transport-stats
--

COMMENT ON COLUMN de_gtfsde.sample.delay_minutes IS 'Null when no realtime data available or when cancelled. Realtime data usually gets nulled by the source system a few minutes after actual arrival/departure. Negative when too early.';


--
-- Name: COLUMN sample.cancelled; Type: COMMENT; Schema: de_gtfsde; Owner: public-transport-stats
--

COMMENT ON COLUMN de_gtfsde.sample.cancelled IS 'Either this stop or the entire trip was cancelled.';


--
-- Name: COLUMN sample.sample_time; Type: COMMENT; Schema: de_gtfsde; Owner: public-transport-stats
--

COMMENT ON COLUMN de_gtfsde.sample.sample_time IS 'When this sample was taken, i.e. when the data contained in this row was current.';


--
-- Name: COLUMN sample.ttl_minutes; Type: COMMENT; Schema: de_gtfsde; Owner: public-transport-stats
--

COMMENT ON COLUMN de_gtfsde.sample.ttl_minutes IS 'Difference between sample_time and projected_time. Positive when arrival/departure was in the future at sample time. Negative when it was in the past.';


--
-- Name: COLUMN sample.trip_id; Type: COMMENT; Schema: de_gtfsde; Owner: public-transport-stats
--

COMMENT ON COLUMN de_gtfsde.sample.trip_id IS 'FPTF tripId';


--
-- Name: COLUMN sample.line_name; Type: COMMENT; Schema: de_gtfsde; Owner: public-transport-stats
--

COMMENT ON COLUMN de_gtfsde.sample.line_name IS 'FPTF line.name';


--
-- Name: COLUMN sample.line_fahrtnr; Type: COMMENT; Schema: de_gtfsde; Owner: public-transport-stats
--

COMMENT ON COLUMN de_gtfsde.sample.line_fahrtnr IS 'FPTF line.fahrtNr';


--
-- Name: COLUMN sample.product_type_id; Type: COMMENT; Schema: de_gtfsde; Owner: public-transport-stats
--

COMMENT ON COLUMN de_gtfsde.sample.product_type_id IS 'FPTF line.product';


--
-- Name: COLUMN sample.product_name; Type: COMMENT; Schema: de_gtfsde; Owner: public-transport-stats
--

COMMENT ON COLUMN de_gtfsde.sample.product_name IS 'FPTF line.productName';


--
-- Name: COLUMN sample.station_id; Type: COMMENT; Schema: de_gtfsde; Owner: public-transport-stats
--

COMMENT ON COLUMN de_gtfsde.sample.station_id IS 'EVA number';


--
-- Name: COLUMN sample.operator_id; Type: COMMENT; Schema: de_gtfsde; Owner: public-transport-stats
--

COMMENT ON COLUMN de_gtfsde.sample.operator_id IS 'FK operator';


--
-- Name: COLUMN sample.is_departure; Type: COMMENT; Schema: de_gtfsde; Owner: public-transport-stats
--

COMMENT ON COLUMN de_gtfsde.sample.is_departure IS 'Indicates arrival/departure.';


--
-- Name: COLUMN sample.remarks_hash; Type: COMMENT; Schema: de_gtfsde; Owner: public-transport-stats
--

COMMENT ON COLUMN de_gtfsde.sample.remarks_hash IS 'FK remarks, FPTF remarks.';


--
-- Name: COLUMN sample.stop_number; Type: COMMENT; Schema: de_gtfsde; Owner: public-transport-stats
--

COMMENT ON COLUMN de_gtfsde.sample.stop_number IS 'Can be used to indicate how many stops came before this stop on this trip.';


--
-- Name: COLUMN sample.load_factor_id; Type: COMMENT; Schema: de_gtfsde; Owner: public-transport-stats
--

COMMENT ON COLUMN de_gtfsde.sample.load_factor_id IS 'FK load_factor';


--
-- Name: COLUMN sample.response_id; Type: COMMENT; Schema: de_gtfsde; Owner: public-transport-stats
--

COMMENT ON COLUMN de_gtfsde.sample.response_id IS 'FK response_log, FPTF loadFactor';


--
-- Name: sample_histogram_by_day; Type: TABLE; Schema: de_gtfsde; Owner: public-transport-stats
--

CREATE TABLE de_gtfsde.sample_histogram_by_day (
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


ALTER TABLE de_gtfsde.sample_histogram_by_day OWNER TO "public-transport-stats";

--
-- Name: sample_histogram_by_duration; Type: TABLE; Schema: de_gtfsde; Owner: public-transport-stats
--

CREATE TABLE de_gtfsde.sample_histogram_by_duration (
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


ALTER TABLE de_gtfsde.sample_histogram_by_duration OWNER TO "public-transport-stats";

--
-- Name: sample_histogram_by_hour; Type: TABLE; Schema: de_gtfsde; Owner: public-transport-stats
--

CREATE TABLE de_gtfsde.sample_histogram_by_hour (
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


ALTER TABLE de_gtfsde.sample_histogram_by_hour OWNER TO "public-transport-stats";

--
-- Name: sample_histogram_by_month; Type: TABLE; Schema: de_gtfsde; Owner: public-transport-stats
--

CREATE TABLE de_gtfsde.sample_histogram_by_month (
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


ALTER TABLE de_gtfsde.sample_histogram_by_month OWNER TO "public-transport-stats";

--
-- Name: sample_histogram_by_station; Type: TABLE; Schema: de_gtfsde; Owner: public-transport-stats
--

CREATE TABLE de_gtfsde.sample_histogram_by_station (
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


ALTER TABLE de_gtfsde.sample_histogram_by_station OWNER TO "public-transport-stats";

--
-- Name: sample_histogram_without_time; Type: TABLE; Schema: de_gtfsde; Owner: public-transport-stats
--

CREATE TABLE de_gtfsde.sample_histogram_without_time (
    product_type_id smallint,
    operator_id smallint,
    is_departure boolean,
    prior_ttl_bucket int4range,
    prior_delay_bucket int4range,
    latest_sample_ttl_bucket int4range,
    latest_sample_delay_bucket int4range,
    sample_count numeric
);


ALTER TABLE de_gtfsde.sample_histogram_without_time OWNER TO "public-transport-stats";

--
-- Name: sample_id_seq; Type: SEQUENCE; Schema: de_gtfsde; Owner: public-transport-stats
--

CREATE UNLOGGED SEQUENCE de_gtfsde.sample_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE de_gtfsde.sample_id_seq OWNER TO "public-transport-stats";

--
-- Name: sample_id_seq; Type: SEQUENCE OWNED BY; Schema: de_gtfsde; Owner: public-transport-stats
--

ALTER SEQUENCE de_gtfsde.sample_id_seq OWNED BY de_gtfsde.sample.id;


--
-- Name: station; Type: TABLE; Schema: de_gtfsde; Owner: public-transport-stats
--

CREATE TABLE de_gtfsde.station (
    station_id text NOT NULL,
    lonlat point NOT NULL,
    name text NOT NULL,
    parent text,
    details jsonb
);


ALTER TABLE de_gtfsde.station OWNER TO "public-transport-stats";

--
-- Name: load_factor load_factor_id; Type: DEFAULT; Schema: de_gtfsde; Owner: public-transport-stats
--

ALTER TABLE ONLY de_gtfsde.load_factor ALTER COLUMN load_factor_id SET DEFAULT nextval('de_gtfsde.load_factor_load_factor_id_seq'::regclass);


--
-- Name: operator operator_id; Type: DEFAULT; Schema: de_gtfsde; Owner: public-transport-stats
--

ALTER TABLE ONLY de_gtfsde.operator ALTER COLUMN operator_id SET DEFAULT nextval('de_gtfsde.operator_operator_id_seq'::regclass);


--
-- Name: product_type product_type_id; Type: DEFAULT; Schema: de_gtfsde; Owner: public-transport-stats
--

ALTER TABLE ONLY de_gtfsde.product_type ALTER COLUMN product_type_id SET DEFAULT nextval('de_gtfsde.product_type_product_type_id_seq'::regclass);


--
-- Name: prognosis_type prognosis_type_id; Type: DEFAULT; Schema: de_gtfsde; Owner: public-transport-stats
--

ALTER TABLE ONLY de_gtfsde.prognosis_type ALTER COLUMN prognosis_type_id SET DEFAULT nextval('de_gtfsde.prognosis_type_prognosis_type_id_seq'::regclass);


--
-- Name: response_log response_id; Type: DEFAULT; Schema: de_gtfsde; Owner: public-transport-stats
--

ALTER TABLE ONLY de_gtfsde.response_log ALTER COLUMN response_id SET DEFAULT nextval('de_gtfsde.response_log_response_id_seq'::regclass);


--
-- Name: sample id; Type: DEFAULT; Schema: de_gtfsde; Owner: public-transport-stats
--

ALTER TABLE ONLY de_gtfsde.sample ALTER COLUMN id SET DEFAULT nextval('de_gtfsde.sample_id_seq'::regclass);


--
-- Name: response_log hash; Type: CONSTRAINT; Schema: de_gtfsde; Owner: public-transport-stats
--

ALTER TABLE ONLY de_gtfsde.response_log
    ADD CONSTRAINT hash UNIQUE (hash);


--
-- Name: load_factor load_factor_name; Type: CONSTRAINT; Schema: de_gtfsde; Owner: public-transport-stats
--

ALTER TABLE ONLY de_gtfsde.load_factor
    ADD CONSTRAINT load_factor_name UNIQUE (name);


--
-- Name: load_factor load_factor_pkey; Type: CONSTRAINT; Schema: de_gtfsde; Owner: public-transport-stats
--

ALTER TABLE ONLY de_gtfsde.load_factor
    ADD CONSTRAINT load_factor_pkey PRIMARY KEY (load_factor_id);


--
-- Name: official_delay_stats_operators official_delay_stats_operators_pk; Type: CONSTRAINT; Schema: de_gtfsde; Owner: public-transport-stats
--

ALTER TABLE ONLY de_gtfsde.official_delay_stats_operators
    ADD CONSTRAINT official_delay_stats_operators_pk PRIMARY KEY (category, operator);


--
-- Name: operator operator_id; Type: CONSTRAINT; Schema: de_gtfsde; Owner: public-transport-stats
--

ALTER TABLE ONLY de_gtfsde.operator
    ADD CONSTRAINT operator_id UNIQUE (id);


--
-- Name: operator operator_pkey; Type: CONSTRAINT; Schema: de_gtfsde; Owner: public-transport-stats
--

ALTER TABLE ONLY de_gtfsde.operator
    ADD CONSTRAINT operator_pkey PRIMARY KEY (operator_id);


--
-- Name: official_delay_stats pk; Type: CONSTRAINT; Schema: de_gtfsde; Owner: public-transport-stats
--

ALTER TABLE ONLY de_gtfsde.official_delay_stats
    ADD CONSTRAINT pk PRIMARY KEY (year, month, category);


--
-- Name: product_type product_type_name; Type: CONSTRAINT; Schema: de_gtfsde; Owner: public-transport-stats
--

ALTER TABLE ONLY de_gtfsde.product_type
    ADD CONSTRAINT product_type_name UNIQUE (name);


--
-- Name: product_type product_type_pkey; Type: CONSTRAINT; Schema: de_gtfsde; Owner: public-transport-stats
--

ALTER TABLE ONLY de_gtfsde.product_type
    ADD CONSTRAINT product_type_pkey PRIMARY KEY (product_type_id);


--
-- Name: prognosis_type prognosis_type_pkey; Type: CONSTRAINT; Schema: de_gtfsde; Owner: public-transport-stats
--

ALTER TABLE ONLY de_gtfsde.prognosis_type
    ADD CONSTRAINT prognosis_type_pkey PRIMARY KEY (prognosis_type_id);


--
-- Name: remarks remarks_pkey; Type: CONSTRAINT; Schema: de_gtfsde; Owner: public-transport-stats
--

ALTER TABLE ONLY de_gtfsde.remarks
    ADD CONSTRAINT remarks_pkey PRIMARY KEY (remarks_hash);


--
-- Name: response_log response_log_pkey; Type: CONSTRAINT; Schema: de_gtfsde; Owner: public-transport-stats
--

ALTER TABLE ONLY de_gtfsde.response_log
    ADD CONSTRAINT response_log_pkey PRIMARY KEY (response_id);


--
-- Name: station station_id; Type: CONSTRAINT; Schema: de_gtfsde; Owner: public-transport-stats
--

ALTER TABLE ONLY de_gtfsde.station
    ADD CONSTRAINT station_id PRIMARY KEY (station_id);


--
-- Name: sample temp_sample_pkey; Type: CONSTRAINT; Schema: de_gtfsde; Owner: public-transport-stats
--

ALTER TABLE ONLY de_gtfsde.sample
    ADD CONSTRAINT temp_sample_pkey PRIMARY KEY (id);


--
-- Name: fki_parent; Type: INDEX; Schema: de_gtfsde; Owner: public-transport-stats
--

CREATE INDEX fki_parent ON de_gtfsde.station USING btree (parent);


--
-- Name: official_delay_stats_operators operator; Type: FK CONSTRAINT; Schema: de_gtfsde; Owner: public-transport-stats
--

ALTER TABLE ONLY de_gtfsde.official_delay_stats_operators
    ADD CONSTRAINT operator FOREIGN KEY (operator) REFERENCES de_gtfsde.operator(id) NOT VALID;


--
-- Name: station station_parent; Type: FK CONSTRAINT; Schema: de_gtfsde; Owner: public-transport-stats
--

ALTER TABLE ONLY de_gtfsde.station
    ADD CONSTRAINT station_parent FOREIGN KEY (parent) REFERENCES de_gtfsde.station(station_id) DEFERRABLE INITIALLY DEFERRED;


--
-- Name: SCHEMA de_gtfsde; Type: ACL; Schema: -; Owner: public-transport-stats
--

GRANT USAGE ON SCHEMA de_gtfsde TO "public-transport-stats-read";


--
-- Name: TABLE load_factor; Type: ACL; Schema: de_gtfsde; Owner: public-transport-stats
--

GRANT SELECT ON TABLE de_gtfsde.load_factor TO "public-transport-stats-read";


--
-- Name: TABLE official_delay_stats; Type: ACL; Schema: de_gtfsde; Owner: public-transport-stats
--

GRANT SELECT ON TABLE de_gtfsde.official_delay_stats TO "public-transport-stats-read";


--
-- Name: TABLE official_delay_stats_operators; Type: ACL; Schema: de_gtfsde; Owner: public-transport-stats
--

GRANT SELECT ON TABLE de_gtfsde.official_delay_stats_operators TO "public-transport-stats-read";


--
-- Name: TABLE operator; Type: ACL; Schema: de_gtfsde; Owner: public-transport-stats
--

GRANT SELECT ON TABLE de_gtfsde.operator TO "public-transport-stats-read";


--
-- Name: TABLE product_type; Type: ACL; Schema: de_gtfsde; Owner: public-transport-stats
--

GRANT SELECT ON TABLE de_gtfsde.product_type TO "public-transport-stats-read";


--
-- Name: TABLE prognosis_type; Type: ACL; Schema: de_gtfsde; Owner: public-transport-stats
--

GRANT SELECT ON TABLE de_gtfsde.prognosis_type TO "public-transport-stats-read";


--
-- Name: SEQUENCE prognosis_type_prognosis_type_id_seq; Type: ACL; Schema: de_gtfsde; Owner: public-transport-stats
--

GRANT SELECT ON SEQUENCE de_gtfsde.prognosis_type_prognosis_type_id_seq TO "public-transport-stats-read";


--
-- Name: TABLE remarks; Type: ACL; Schema: de_gtfsde; Owner: public-transport-stats
--

GRANT SELECT ON TABLE de_gtfsde.remarks TO "public-transport-stats-read";


--
-- Name: TABLE response_log; Type: ACL; Schema: de_gtfsde; Owner: public-transport-stats
--

GRANT SELECT ON TABLE de_gtfsde.response_log TO "public-transport-stats-read";


--
-- Name: TABLE sample_histogram_by_day; Type: ACL; Schema: de_gtfsde; Owner: public-transport-stats
--

GRANT SELECT ON TABLE de_gtfsde.sample_histogram_by_day TO "public-transport-stats-read";


--
-- Name: TABLE sample_histogram_by_duration; Type: ACL; Schema: de_gtfsde; Owner: public-transport-stats
--

GRANT SELECT ON TABLE de_gtfsde.sample_histogram_by_duration TO "public-transport-stats-read";


--
-- Name: TABLE sample_histogram_by_hour; Type: ACL; Schema: de_gtfsde; Owner: public-transport-stats
--

GRANT SELECT ON TABLE de_gtfsde.sample_histogram_by_hour TO "public-transport-stats-read";


--
-- Name: TABLE sample_histogram_by_month; Type: ACL; Schema: de_gtfsde; Owner: public-transport-stats
--

GRANT SELECT ON TABLE de_gtfsde.sample_histogram_by_month TO "public-transport-stats-read";


--
-- Name: TABLE sample_histogram_by_station; Type: ACL; Schema: de_gtfsde; Owner: public-transport-stats
--

GRANT SELECT ON TABLE de_gtfsde.sample_histogram_by_station TO "public-transport-stats-read";


--
-- Name: TABLE sample_histogram_without_time; Type: ACL; Schema: de_gtfsde; Owner: public-transport-stats
--

GRANT SELECT ON TABLE de_gtfsde.sample_histogram_without_time TO "public-transport-stats-read";


--
-- Name: TABLE station; Type: ACL; Schema: de_gtfsde; Owner: public-transport-stats
--

GRANT SELECT ON TABLE de_gtfsde.station TO "public-transport-stats-read";


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: de_gtfsde; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA de_gtfsde GRANT SELECT ON SEQUENCES  TO "public-transport-stats-read";


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: de_gtfsde; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA de_gtfsde GRANT SELECT ON TABLES  TO "public-transport-stats-read";


--
-- PostgreSQL database dump complete
--

