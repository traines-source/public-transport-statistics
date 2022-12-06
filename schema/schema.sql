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
-- Name: db; Type: SCHEMA; Schema: -; Owner: public-transport-stats
--

CREATE SCHEMA db;


ALTER SCHEMA db OWNER TO "public-transport-stats";

--
-- Name: delay_bucket(smallint); Type: FUNCTION; Schema: db; Owner: public-transport-stats
--

CREATE FUNCTION db.delay_bucket(val smallint) RETURNS smallint
    LANGUAGE sql
    AS $$SELECT
CAST(
	CASE 	
	WHEN val <= -90 THEN -90
	WHEN val <= -75 THEN -75
	WHEN val <= -60 THEN -60
	WHEN val <= -45 THEN -45
	WHEN val <= -30 THEN -30
	WHEN val <= -25 THEN -25
	WHEN val <= -20 THEN -20
	WHEN val <= -15 THEN -15
	WHEN val <= -10 THEN -10
	WHEN val <= -5 THEN -5
	WHEN val <= 0 THEN 0
	WHEN val <= 5 THEN 5
	WHEN val <= 10 THEN 10
	WHEN val <= 15 THEN 15
	WHEN val <= 20 THEN 20
	WHEN val <= 25 THEN 25
	WHEN val <= 30 THEN 30
	WHEN val <= 45 THEN 45
	WHEN val <= 60 THEN 60
	WHEN val <= 75 THEN 75
	WHEN val <= 90 THEN 90
	WHEN val > 90 THEN 32767
	ELSE NULL END
	AS smallint
) AS delay_le$$;


ALTER FUNCTION db.delay_bucket(val smallint) OWNER TO "public-transport-stats";

--
-- Name: delay_bucket_range(smallint); Type: FUNCTION; Schema: db; Owner: public-transport-stats
--

CREATE FUNCTION db.delay_bucket_range(val smallint) RETURNS int4range
    LANGUAGE sql
    AS $$SELECT
CAST(
	CASE 	
	WHEN val <= -90 THEN '(,-90]'
	WHEN val <= -75 THEN '(-90,-75]'
	WHEN val <= -60 THEN '(-75,-60]'
	WHEN val <= -45 THEN '(-60,-45]'
	WHEN val <= -30 THEN '(-45,-30]'
	WHEN val <= -25 THEN '(-30,-25]'
	WHEN val <= -20 THEN '(-25,-20]'
	WHEN val <= -15 THEN '(-20,-15]'
	WHEN val <= -10 THEN '(-15,-10]'
	WHEN val <= -5 THEN '(-10,-5]'
	WHEN val <= 0 THEN '(-5,0]'
	WHEN val <= 5 THEN '(0,5]'
	WHEN val <= 10 THEN '(5,10]'
	WHEN val <= 15 THEN '(10,15]'
	WHEN val <= 20 THEN '(15,20]'
	WHEN val <= 25 THEN '(20,25]'
	WHEN val <= 30 THEN '(25,30]'
	WHEN val <= 45 THEN '(30,45]'
	WHEN val <= 60 THEN '(45,60]'
	WHEN val <= 75 THEN '(60,75]'
	WHEN val <= 90 THEN '(75,90]'
	WHEN val > 90 THEN '(90,)'
	ELSE NULL END
	AS int4range
) AS delay_bucket$$;


ALTER FUNCTION db.delay_bucket_range(val smallint) OWNER TO "public-transport-stats";

--
-- Name: response_type_name(smallint); Type: FUNCTION; Schema: db; Owner: public-transport-stats
--

CREATE FUNCTION db.response_type_name(val smallint) RETURNS text
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


ALTER FUNCTION db.response_type_name(val smallint) OWNER TO "public-transport-stats";

--
-- Name: ttl_bucket(smallint); Type: FUNCTION; Schema: db; Owner: public-transport-stats
--

CREATE FUNCTION db.ttl_bucket(val smallint) RETURNS smallint
    LANGUAGE sql
    AS $$SELECT
CAST(
	CASE
	WHEN val <= -5 THEN -5
	WHEN val <= 0 THEN 0
	WHEN val <= 5 THEN 5
	WHEN val <= 10 THEN 10
	WHEN val <= 15 THEN 15
	WHEN val <= 20 THEN 20
	WHEN val <= 25 THEN 25
	WHEN val <= 30 THEN 30
	WHEN val <= 45 THEN 45
	WHEN val <= 60 THEN 60
	WHEN val <= 75 THEN 75
	WHEN val <= 90 THEN 90
	WHEN val > 90 THEN 32767
	ELSE NULL END
	AS smallint
) AS ttl_le$$;


ALTER FUNCTION db.ttl_bucket(val smallint) OWNER TO "public-transport-stats";

--
-- Name: ttl_bucket_range(smallint); Type: FUNCTION; Schema: db; Owner: public-transport-stats
--

CREATE FUNCTION db.ttl_bucket_range(val smallint) RETURNS int4range
    LANGUAGE sql
    AS $$SELECT
CAST(
	CASE
	WHEN val <= -5 THEN '(,-5]'
	WHEN val <= 0 THEN '(-5,0]'
	WHEN val <= 5 THEN '(0,5]'
	WHEN val <= 10 THEN '(5,10]'
	WHEN val <= 15 THEN '(10,15]'
	WHEN val <= 20 THEN '(15,20]'
	WHEN val <= 25 THEN '(20,25]'
	WHEN val <= 30 THEN '(25,30]'
	WHEN val <= 45 THEN '(30,45]'
	WHEN val <= 60 THEN '(45,60]'
	WHEN val <= 75 THEN '(60,75]'
	WHEN val <= 90 THEN '(75,90]'
	WHEN val > 90 THEN '(90,)'
	ELSE NULL END
	AS int4range
) AS ttl_bucket$$;


ALTER FUNCTION db.ttl_bucket_range(val smallint) OWNER TO "public-transport-stats";

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: load_factor; Type: TABLE; Schema: db; Owner: public-transport-stats
--

CREATE TABLE db.load_factor (
    load_factor_id smallint NOT NULL,
    name text NOT NULL
);


ALTER TABLE db.load_factor OWNER TO "public-transport-stats";

--
-- Name: load_factor_load_factor_id_seq; Type: SEQUENCE; Schema: db; Owner: public-transport-stats
--

CREATE SEQUENCE db.load_factor_load_factor_id_seq
    AS smallint
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE db.load_factor_load_factor_id_seq OWNER TO "public-transport-stats";

--
-- Name: load_factor_load_factor_id_seq; Type: SEQUENCE OWNED BY; Schema: db; Owner: public-transport-stats
--

ALTER SEQUENCE db.load_factor_load_factor_id_seq OWNED BY db.load_factor.load_factor_id;


--
-- Name: official_delay_stats; Type: TABLE; Schema: db; Owner: public-transport-stats
--

CREATE TABLE db.official_delay_stats (
    year smallint NOT NULL,
    month smallint NOT NULL,
    delay_percentage_5min real NOT NULL,
    delay_percentage_15min real NOT NULL,
    category text NOT NULL
);


ALTER TABLE db.official_delay_stats OWNER TO "public-transport-stats";

--
-- Name: official_delay_stats_operators; Type: TABLE; Schema: db; Owner: public-transport-stats
--

CREATE TABLE db.official_delay_stats_operators (
    category text NOT NULL,
    operator text NOT NULL
);


ALTER TABLE db.official_delay_stats_operators OWNER TO "public-transport-stats";

--
-- Name: operator; Type: TABLE; Schema: db; Owner: public-transport-stats
--

CREATE TABLE db.operator (
    operator_id smallint NOT NULL,
    id text NOT NULL,
    name text
);


ALTER TABLE db.operator OWNER TO "public-transport-stats";

--
-- Name: operator_operator_id_seq; Type: SEQUENCE; Schema: db; Owner: public-transport-stats
--

CREATE SEQUENCE db.operator_operator_id_seq
    AS smallint
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE db.operator_operator_id_seq OWNER TO "public-transport-stats";

--
-- Name: operator_operator_id_seq; Type: SEQUENCE OWNED BY; Schema: db; Owner: public-transport-stats
--

ALTER SEQUENCE db.operator_operator_id_seq OWNED BY db.operator.operator_id;


--
-- Name: product_type; Type: TABLE; Schema: db; Owner: public-transport-stats
--

CREATE TABLE db.product_type (
    product_type_id smallint NOT NULL,
    name text NOT NULL
);


ALTER TABLE db.product_type OWNER TO "public-transport-stats";

--
-- Name: product_type_product_type_id_seq; Type: SEQUENCE; Schema: db; Owner: public-transport-stats
--

CREATE SEQUENCE db.product_type_product_type_id_seq
    AS smallint
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE db.product_type_product_type_id_seq OWNER TO "public-transport-stats";

--
-- Name: product_type_product_type_id_seq; Type: SEQUENCE OWNED BY; Schema: db; Owner: public-transport-stats
--

ALTER SEQUENCE db.product_type_product_type_id_seq OWNED BY db.product_type.product_type_id;


--
-- Name: remarks; Type: TABLE; Schema: db; Owner: public-transport-stats
--

CREATE TABLE db.remarks (
    remarks_hash uuid NOT NULL,
    remarks jsonb NOT NULL
);


ALTER TABLE db.remarks OWNER TO "public-transport-stats";

--
-- Name: response_log; Type: TABLE; Schema: db; Owner: public-transport-stats
--

CREATE TABLE db.response_log (
    response_id integer NOT NULL,
    hash uuid NOT NULL,
    type smallint NOT NULL,
    response_time timestamp with time zone NOT NULL,
    source smallint NOT NULL,
    sample_count integer NOT NULL,
    response_time_estimated boolean NOT NULL,
    sample_time_estimated boolean NOT NULL
);


ALTER TABLE db.response_log OWNER TO "public-transport-stats";

--
-- Name: response_log_response_id_seq; Type: SEQUENCE; Schema: db; Owner: public-transport-stats
--

CREATE SEQUENCE db.response_log_response_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE db.response_log_response_id_seq OWNER TO "public-transport-stats";

--
-- Name: response_log_response_id_seq; Type: SEQUENCE OWNED BY; Schema: db; Owner: public-transport-stats
--

ALTER SEQUENCE db.response_log_response_id_seq OWNED BY db.response_log.response_id;


--
-- Name: sample; Type: TABLE; Schema: db; Owner: public-transport-stats
--

CREATE TABLE db.sample (
    id bigint NOT NULL,
    scheduled_time timestamp with time zone NOT NULL,
    projected_time timestamp with time zone,
    delay_minutes smallint,
    cancelled boolean NOT NULL,
    sample_time timestamp with time zone NOT NULL,
    ttl_minutes smallint NOT NULL,
    trip_id text NOT NULL,
    line_name text,
    line_fahrtnr integer,
    product_type_id smallint,
    product_name text,
    station_id integer NOT NULL,
    operator_id smallint,
    is_departure boolean NOT NULL,
    remarks_hash uuid,
    stop_number smallint,
    destination_provenance_id integer,
    scheduled_platform text,
    projected_platform text,
    load_factor_id smallint,
    response_id integer NOT NULL
);


ALTER TABLE db.sample OWNER TO "public-transport-stats";

--
-- Name: COLUMN sample.id; Type: COMMENT; Schema: db; Owner: public-transport-stats
--

COMMENT ON COLUMN db.sample.id IS 'autoincrement id';


--
-- Name: COLUMN sample.scheduled_time; Type: COMMENT; Schema: db; Owner: public-transport-stats
--

COMMENT ON COLUMN db.sample.scheduled_time IS 'FPTF plannedWhen/plannedDrrival/plannedDeparture, time when arrival/departure was originally scheduled';


--
-- Name: COLUMN sample.projected_time; Type: COMMENT; Schema: db; Owner: public-transport-stats
--

COMMENT ON COLUMN db.sample.projected_time IS 'FPTF when/arrival/departure, time when arrival/departure is currently projected based on delay. Null only when cancelled. When delay_minutes is null, this field is still set (then equal to scheduled_time)';


--
-- Name: COLUMN sample.delay_minutes; Type: COMMENT; Schema: db; Owner: public-transport-stats
--

COMMENT ON COLUMN db.sample.delay_minutes IS 'Null when no realtime data available or when cancelled. Realtime data usually gets nulled by the source system a few minutes after actual arrival/departure. Negative when too early.';


--
-- Name: COLUMN sample.cancelled; Type: COMMENT; Schema: db; Owner: public-transport-stats
--

COMMENT ON COLUMN db.sample.cancelled IS 'Either this stop or the entire trip was cancelled.';


--
-- Name: COLUMN sample.sample_time; Type: COMMENT; Schema: db; Owner: public-transport-stats
--

COMMENT ON COLUMN db.sample.sample_time IS 'When this sample was taken, i.e. when the data contained in this row was current.';


--
-- Name: COLUMN sample.ttl_minutes; Type: COMMENT; Schema: db; Owner: public-transport-stats
--

COMMENT ON COLUMN db.sample.ttl_minutes IS 'Difference between sample_time and projected_time. Positive when arrival/departure was in the future at sample time. Negative when it was in the past.';


--
-- Name: COLUMN sample.trip_id; Type: COMMENT; Schema: db; Owner: public-transport-stats
--

COMMENT ON COLUMN db.sample.trip_id IS 'FPTF tripId';


--
-- Name: COLUMN sample.line_name; Type: COMMENT; Schema: db; Owner: public-transport-stats
--

COMMENT ON COLUMN db.sample.line_name IS 'FPTF line.name';


--
-- Name: COLUMN sample.line_fahrtnr; Type: COMMENT; Schema: db; Owner: public-transport-stats
--

COMMENT ON COLUMN db.sample.line_fahrtnr IS 'FPTF line.fahrtNr';


--
-- Name: COLUMN sample.product_type_id; Type: COMMENT; Schema: db; Owner: public-transport-stats
--

COMMENT ON COLUMN db.sample.product_type_id IS 'FPTF line.product';


--
-- Name: COLUMN sample.product_name; Type: COMMENT; Schema: db; Owner: public-transport-stats
--

COMMENT ON COLUMN db.sample.product_name IS 'FPTF line.productName';


--
-- Name: COLUMN sample.station_id; Type: COMMENT; Schema: db; Owner: public-transport-stats
--

COMMENT ON COLUMN db.sample.station_id IS 'EVA number';


--
-- Name: COLUMN sample.operator_id; Type: COMMENT; Schema: db; Owner: public-transport-stats
--

COMMENT ON COLUMN db.sample.operator_id IS 'FK operator';


--
-- Name: COLUMN sample.is_departure; Type: COMMENT; Schema: db; Owner: public-transport-stats
--

COMMENT ON COLUMN db.sample.is_departure IS 'Indicates arrival/departure.';


--
-- Name: COLUMN sample.remarks_hash; Type: COMMENT; Schema: db; Owner: public-transport-stats
--

COMMENT ON COLUMN db.sample.remarks_hash IS 'FK remarks, FPTF remarks.';


--
-- Name: COLUMN sample.stop_number; Type: COMMENT; Schema: db; Owner: public-transport-stats
--

COMMENT ON COLUMN db.sample.stop_number IS 'Can be used to indicate how many stops came before this stop on this trip.';


--
-- Name: COLUMN sample.destination_provenance_id; Type: COMMENT; Schema: db; Owner: public-transport-stats
--

COMMENT ON COLUMN db.sample.destination_provenance_id IS 'Destination if is_departure, provenance if NOT is_departure.';


--
-- Name: COLUMN sample.scheduled_platform; Type: COMMENT; Schema: db; Owner: public-transport-stats
--

COMMENT ON COLUMN db.sample.scheduled_platform IS 'FPTF plannedPlatform';


--
-- Name: COLUMN sample.projected_platform; Type: COMMENT; Schema: db; Owner: public-transport-stats
--

COMMENT ON COLUMN db.sample.projected_platform IS 'FPTF platform';


--
-- Name: COLUMN sample.load_factor_id; Type: COMMENT; Schema: db; Owner: public-transport-stats
--

COMMENT ON COLUMN db.sample.load_factor_id IS 'FK load_factor';


--
-- Name: COLUMN sample.response_id; Type: COMMENT; Schema: db; Owner: public-transport-stats
--

COMMENT ON COLUMN db.sample.response_id IS 'FK response_log, FPTF loadFactor';


--
-- Name: sample_histogram; Type: MATERIALIZED VIEW; Schema: db; Owner: public-transport-stats
--

CREATE MATERIALIZED VIEW db.sample_histogram AS
 SELECT r.scheduled_time,
    (date_part('year'::text, r.scheduled_time))::smallint AS year,
    (date_part('month'::text, r.scheduled_time))::smallint AS month,
    (date_part('day'::text, r.scheduled_time))::smallint AS day,
    (date_part('dow'::text, r.scheduled_time))::smallint AS day_of_week,
    (date_part('hour'::text, r.scheduled_time))::smallint AS hour,
    r.product_type_id,
    r.station_id,
    r.operator_id,
    r.is_departure,
    r.prior_ttl_bucket,
    r.prior_delay_bucket,
    r.latest_sample_ttl_bucket,
    r.latest_sample_delay_bucket,
    r.sample_count,
    sum(r.sample_count) OVER (PARTITION BY r.scheduled_time, r.product_type_id, r.station_id, r.is_departure, r.prior_delay_bucket, r.prior_ttl_bucket, r.latest_sample_ttl_bucket) AS total_sample_count
   FROM ( SELECT date_trunc('hour'::text, s.scheduled_time) AS scheduled_time,
            s.product_type_id,
            s.station_id,
            s.operator_id,
            s.is_departure,
                CASE
                    WHEN (latest_sample.id = s.id) THEN NULL::int4range
                    ELSE db.ttl_bucket_range(s.ttl_minutes)
                END AS prior_ttl_bucket,
                CASE
                    WHEN (latest_sample.id = s.id) THEN NULL::int4range
                    ELSE db.delay_bucket_range(s.delay_minutes)
                END AS prior_delay_bucket,
            db.ttl_bucket_range(latest_sample.ttl_minutes) AS latest_sample_ttl_bucket,
                CASE
                    WHEN ((latest_sample.id = s.id) OR (s.delay_minutes IS NULL)) THEN db.delay_bucket_range(latest_sample.delay_minutes)
                    ELSE db.delay_bucket_range((latest_sample.delay_minutes - s.delay_minutes))
                END AS latest_sample_delay_bucket,
            count(*) AS sample_count
           FROM (db.sample s
             JOIN ( SELECT sample.sample_time,
                    sample.trip_id,
                    sample.scheduled_time,
                    sample.station_id,
                    sample.is_departure,
                    min(sample.ttl_minutes) AS ttl_minutes,
                    bool_or(sample.cancelled) AS cancelled,
                    max(sample.id) AS id,
                        CASE
                            WHEN bool_or(sample.cancelled) THEN NULL::smallint
                            ELSE max(sample.delay_minutes)
                        END AS delay_minutes
                   FROM (db.sample
                     JOIN ( SELECT max(sample_1.sample_time) AS sample_time,
                            sample_1.trip_id,
                            sample_1.scheduled_time,
                            sample_1.station_id,
                            sample_1.is_departure
                           FROM db.sample sample_1
                          WHERE ((sample_1.delay_minutes IS NOT NULL) OR sample_1.cancelled)
                          GROUP BY sample_1.trip_id, sample_1.scheduled_time, sample_1.station_id, sample_1.is_departure) latest_live_sample USING (scheduled_time, sample_time, trip_id, station_id, is_departure))
                  GROUP BY sample.sample_time, sample.trip_id, sample.scheduled_time, sample.station_id, sample.is_departure) latest_sample ON (((s.trip_id = latest_sample.trip_id) AND (s.scheduled_time = latest_sample.scheduled_time) AND (s.station_id = latest_sample.station_id) AND (s.is_departure = latest_sample.is_departure))))
          GROUP BY (date_trunc('hour'::text, s.scheduled_time)), s.product_type_id, s.station_id, s.operator_id, s.is_departure,
                CASE
                    WHEN (latest_sample.id = s.id) THEN NULL::int4range
                    ELSE db.delay_bucket_range(s.delay_minutes)
                END,
                CASE
                    WHEN (latest_sample.id = s.id) THEN NULL::int4range
                    ELSE db.ttl_bucket_range(s.ttl_minutes)
                END,
                CASE
                    WHEN ((latest_sample.id = s.id) OR (s.delay_minutes IS NULL)) THEN db.delay_bucket_range(latest_sample.delay_minutes)
                    ELSE db.delay_bucket_range((latest_sample.delay_minutes - s.delay_minutes))
                END, (db.ttl_bucket_range(latest_sample.ttl_minutes))) r
  WITH NO DATA;


ALTER TABLE db.sample_histogram OWNER TO "public-transport-stats";

--
-- Name: sample_id_seq; Type: SEQUENCE; Schema: db; Owner: public-transport-stats
--

CREATE SEQUENCE db.sample_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE db.sample_id_seq OWNER TO "public-transport-stats";

--
-- Name: sample_id_seq; Type: SEQUENCE OWNED BY; Schema: db; Owner: public-transport-stats
--

ALTER SEQUENCE db.sample_id_seq OWNED BY db.sample.id;


--
-- Name: station; Type: TABLE; Schema: db; Owner: public-transport-stats
--

CREATE TABLE db.station (
    station_id integer NOT NULL,
    lonlat point NOT NULL,
    name text NOT NULL,
    parent integer
);


ALTER TABLE db.station OWNER TO "public-transport-stats";

--
-- Name: load_factor load_factor_id; Type: DEFAULT; Schema: db; Owner: public-transport-stats
--

ALTER TABLE ONLY db.load_factor ALTER COLUMN load_factor_id SET DEFAULT nextval('db.load_factor_load_factor_id_seq'::regclass);


--
-- Name: operator operator_id; Type: DEFAULT; Schema: db; Owner: public-transport-stats
--

ALTER TABLE ONLY db.operator ALTER COLUMN operator_id SET DEFAULT nextval('db.operator_operator_id_seq'::regclass);


--
-- Name: product_type product_type_id; Type: DEFAULT; Schema: db; Owner: public-transport-stats
--

ALTER TABLE ONLY db.product_type ALTER COLUMN product_type_id SET DEFAULT nextval('db.product_type_product_type_id_seq'::regclass);


--
-- Name: response_log response_id; Type: DEFAULT; Schema: db; Owner: public-transport-stats
--

ALTER TABLE ONLY db.response_log ALTER COLUMN response_id SET DEFAULT nextval('db.response_log_response_id_seq'::regclass);


--
-- Name: sample id; Type: DEFAULT; Schema: db; Owner: public-transport-stats
--

ALTER TABLE ONLY db.sample ALTER COLUMN id SET DEFAULT nextval('db.sample_id_seq'::regclass);


--
-- Name: response_log hash; Type: CONSTRAINT; Schema: db; Owner: public-transport-stats
--

ALTER TABLE ONLY db.response_log
    ADD CONSTRAINT hash UNIQUE (hash);


--
-- Name: sample id; Type: CONSTRAINT; Schema: db; Owner: public-transport-stats
--

ALTER TABLE ONLY db.sample
    ADD CONSTRAINT id PRIMARY KEY (id);


--
-- Name: load_factor load_factor_name; Type: CONSTRAINT; Schema: db; Owner: public-transport-stats
--

ALTER TABLE ONLY db.load_factor
    ADD CONSTRAINT load_factor_name UNIQUE (name);


--
-- Name: load_factor load_factor_pkey; Type: CONSTRAINT; Schema: db; Owner: public-transport-stats
--

ALTER TABLE ONLY db.load_factor
    ADD CONSTRAINT load_factor_pkey PRIMARY KEY (load_factor_id);


--
-- Name: official_delay_stats_operators official_delay_stats_operators_pk; Type: CONSTRAINT; Schema: db; Owner: public-transport-stats
--

ALTER TABLE ONLY db.official_delay_stats_operators
    ADD CONSTRAINT official_delay_stats_operators_pk PRIMARY KEY (category, operator);


--
-- Name: operator operator_id; Type: CONSTRAINT; Schema: db; Owner: public-transport-stats
--

ALTER TABLE ONLY db.operator
    ADD CONSTRAINT operator_id UNIQUE (id);


--
-- Name: operator operator_pkey; Type: CONSTRAINT; Schema: db; Owner: public-transport-stats
--

ALTER TABLE ONLY db.operator
    ADD CONSTRAINT operator_pkey PRIMARY KEY (operator_id);


--
-- Name: official_delay_stats pk; Type: CONSTRAINT; Schema: db; Owner: public-transport-stats
--

ALTER TABLE ONLY db.official_delay_stats
    ADD CONSTRAINT pk PRIMARY KEY (year, month, category);


--
-- Name: product_type product_type_name; Type: CONSTRAINT; Schema: db; Owner: public-transport-stats
--

ALTER TABLE ONLY db.product_type
    ADD CONSTRAINT product_type_name UNIQUE (name);


--
-- Name: product_type product_type_pkey; Type: CONSTRAINT; Schema: db; Owner: public-transport-stats
--

ALTER TABLE ONLY db.product_type
    ADD CONSTRAINT product_type_pkey PRIMARY KEY (product_type_id);


--
-- Name: remarks remarks_pkey; Type: CONSTRAINT; Schema: db; Owner: public-transport-stats
--

ALTER TABLE ONLY db.remarks
    ADD CONSTRAINT remarks_pkey PRIMARY KEY (remarks_hash);


--
-- Name: response_log response_log_pkey; Type: CONSTRAINT; Schema: db; Owner: public-transport-stats
--

ALTER TABLE ONLY db.response_log
    ADD CONSTRAINT response_log_pkey PRIMARY KEY (response_id);


--
-- Name: station station_id; Type: CONSTRAINT; Schema: db; Owner: public-transport-stats
--

ALTER TABLE ONLY db.station
    ADD CONSTRAINT station_id PRIMARY KEY (station_id);


--
-- Name: by_scheduled; Type: INDEX; Schema: db; Owner: public-transport-stats
--

CREATE INDEX by_scheduled ON db.sample USING btree (scheduled_time);

ALTER TABLE db.sample CLUSTER ON by_scheduled;


--
-- Name: fki_parent; Type: INDEX; Schema: db; Owner: public-transport-stats
--

CREATE INDEX fki_parent ON db.station USING btree (parent);


--
-- Name: sample destination_provenance_id; Type: FK CONSTRAINT; Schema: db; Owner: public-transport-stats
--

ALTER TABLE ONLY db.sample
    ADD CONSTRAINT destination_provenance_id FOREIGN KEY (destination_provenance_id) REFERENCES db.station(station_id);


--
-- Name: sample load_factor_id; Type: FK CONSTRAINT; Schema: db; Owner: public-transport-stats
--

ALTER TABLE ONLY db.sample
    ADD CONSTRAINT load_factor_id FOREIGN KEY (load_factor_id) REFERENCES db.load_factor(load_factor_id);


--
-- Name: official_delay_stats_operators operator; Type: FK CONSTRAINT; Schema: db; Owner: public-transport-stats
--

ALTER TABLE ONLY db.official_delay_stats_operators
    ADD CONSTRAINT operator FOREIGN KEY (operator) REFERENCES db.operator(id) NOT VALID;


--
-- Name: sample operator_id; Type: FK CONSTRAINT; Schema: db; Owner: public-transport-stats
--

ALTER TABLE ONLY db.sample
    ADD CONSTRAINT operator_id FOREIGN KEY (operator_id) REFERENCES db.operator(operator_id);


--
-- Name: sample product_type_id; Type: FK CONSTRAINT; Schema: db; Owner: public-transport-stats
--

ALTER TABLE ONLY db.sample
    ADD CONSTRAINT product_type_id FOREIGN KEY (product_type_id) REFERENCES db.product_type(product_type_id);


--
-- Name: sample remarks_hash; Type: FK CONSTRAINT; Schema: db; Owner: public-transport-stats
--

ALTER TABLE ONLY db.sample
    ADD CONSTRAINT remarks_hash FOREIGN KEY (remarks_hash) REFERENCES db.remarks(remarks_hash);


--
-- Name: sample response_id; Type: FK CONSTRAINT; Schema: db; Owner: public-transport-stats
--

ALTER TABLE ONLY db.sample
    ADD CONSTRAINT response_id FOREIGN KEY (response_id) REFERENCES db.response_log(response_id);


--
-- Name: sample station_id; Type: FK CONSTRAINT; Schema: db; Owner: public-transport-stats
--

ALTER TABLE ONLY db.sample
    ADD CONSTRAINT station_id FOREIGN KEY (station_id) REFERENCES db.station(station_id);


--
-- Name: station station_parent; Type: FK CONSTRAINT; Schema: db; Owner: public-transport-stats
--

ALTER TABLE ONLY db.station
    ADD CONSTRAINT station_parent FOREIGN KEY (parent) REFERENCES db.station(station_id) DEFERRABLE INITIALLY DEFERRED;


--
-- Name: SCHEMA db; Type: ACL; Schema: -; Owner: public-transport-stats
--

GRANT USAGE ON SCHEMA db TO "public-transport-stats-read";


--
-- Name: TABLE load_factor; Type: ACL; Schema: db; Owner: public-transport-stats
--

GRANT SELECT ON TABLE db.load_factor TO "public-transport-stats-read";


--
-- Name: TABLE official_delay_stats; Type: ACL; Schema: db; Owner: public-transport-stats
--

GRANT SELECT ON TABLE db.official_delay_stats TO "public-transport-stats-read";


--
-- Name: TABLE official_delay_stats_operators; Type: ACL; Schema: db; Owner: public-transport-stats
--

GRANT SELECT ON TABLE db.official_delay_stats_operators TO "public-transport-stats-read";


--
-- Name: TABLE operator; Type: ACL; Schema: db; Owner: public-transport-stats
--

GRANT SELECT ON TABLE db.operator TO "public-transport-stats-read";


--
-- Name: TABLE product_type; Type: ACL; Schema: db; Owner: public-transport-stats
--

GRANT SELECT ON TABLE db.product_type TO "public-transport-stats-read";


--
-- Name: TABLE remarks; Type: ACL; Schema: db; Owner: public-transport-stats
--

GRANT SELECT ON TABLE db.remarks TO "public-transport-stats-read";


--
-- Name: TABLE response_log; Type: ACL; Schema: db; Owner: public-transport-stats
--

GRANT SELECT ON TABLE db.response_log TO "public-transport-stats-read";


--
-- Name: TABLE sample; Type: ACL; Schema: db; Owner: public-transport-stats
--

GRANT SELECT ON TABLE db.sample TO "public-transport-stats-read";


--
-- Name: TABLE sample_histogram; Type: ACL; Schema: db; Owner: public-transport-stats
--

GRANT SELECT ON TABLE db.sample_histogram TO "public-transport-stats-read";


--
-- Name: TABLE station; Type: ACL; Schema: db; Owner: public-transport-stats
--

GRANT SELECT ON TABLE db.station TO "public-transport-stats-read";


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: db; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA db GRANT SELECT ON SEQUENCES  TO "public-transport-stats-read";


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: db; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA db GRANT SELECT ON TABLES  TO "public-transport-stats-read";


--
-- PostgreSQL database dump complete
--

