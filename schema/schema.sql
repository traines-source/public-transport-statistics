--
-- PostgreSQL database dump
--

-- Dumped from database version 12.2 (Debian 12.2-2.pgdg100+1)
-- Dumped by pg_dump version 12.2 (Debian 12.2-2.pgdg100+1)

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
-- Name: load_factor_id_seq; Type: SEQUENCE; Schema: db; Owner: public-transport-stats
--

CREATE SEQUENCE db.load_factor_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE db.load_factor_id_seq OWNER TO "public-transport-stats";

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: load_factor; Type: TABLE; Schema: db; Owner: public-transport-stats
--

CREATE TABLE db.load_factor (
    load_factor_id smallint DEFAULT nextval('db.load_factor_id_seq'::regclass) NOT NULL,
    name text NOT NULL
);


ALTER TABLE db.load_factor OWNER TO "public-transport-stats";

--
-- Name: operator_id_seq; Type: SEQUENCE; Schema: db; Owner: public-transport-stats
--

CREATE SEQUENCE db.operator_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE db.operator_id_seq OWNER TO "public-transport-stats";

--
-- Name: operator; Type: TABLE; Schema: db; Owner: public-transport-stats
--

CREATE TABLE db.operator (
    operator_id smallint DEFAULT nextval('db.operator_id_seq'::regclass) NOT NULL,
    id text NOT NULL,
    name text
);


ALTER TABLE db.operator OWNER TO "public-transport-stats";

--
-- Name: product_type_id_seq; Type: SEQUENCE; Schema: db; Owner: public-transport-stats
--

CREATE SEQUENCE db.product_type_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE db.product_type_id_seq OWNER TO "public-transport-stats";

--
-- Name: product_type; Type: TABLE; Schema: db; Owner: public-transport-stats
--

CREATE TABLE db.product_type (
    product_type_id smallint DEFAULT nextval('db.product_type_id_seq'::regclass) NOT NULL,
    name text NOT NULL
);


ALTER TABLE db.product_type OWNER TO "public-transport-stats";

--
-- Name: response_id_seq; Type: SEQUENCE; Schema: db; Owner: public-transport-stats
--

CREATE SEQUENCE db.response_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE db.response_id_seq OWNER TO "public-transport-stats";

--
-- Name: response_log; Type: TABLE; Schema: db; Owner: public-transport-stats
--

CREATE TABLE db.response_log (
    hash text NOT NULL,
    type smallint NOT NULL,
    response_time timestamp with time zone,
    response_id integer DEFAULT nextval('db.response_id_seq'::regclass) NOT NULL,
    source smallint NOT NULL,
    sample_count integer,
    rt_time timestamp with time zone
);


ALTER TABLE db.response_log OWNER TO "public-transport-stats";

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
-- Name: sample; Type: TABLE; Schema: db; Owner: public-transport-stats
--

CREATE TABLE db.sample (
    id bigint DEFAULT nextval('db.sample_id_seq'::regclass) NOT NULL,
    year smallint NOT NULL,
    month smallint NOT NULL,
    day smallint NOT NULL,
    day_of_week smallint NOT NULL,
    hour smallint NOT NULL,
    minute smallint NOT NULL,
    trip_id text NOT NULL,
    line_name text NOT NULL,
    line_fahrtnr integer NOT NULL,
    product_type_id smallint NOT NULL,
    product_name text,
    station_id integer NOT NULL,
    scheduled_time timestamp with time zone NOT NULL,
    projected_time timestamp with time zone NOT NULL,
    is_departure boolean NOT NULL,
    delay_minutes smallint,
    remarks jsonb,
    cancelled boolean NOT NULL,
    stop_number smallint,
    sample_time timestamp with time zone NOT NULL,
    ttl_minutes smallint NOT NULL,
    operator_id smallint,
    destination_provenance_id integer,
    scheduled_platform text,
    projected_platform text,
    load_factor_id smallint,
    response_id integer NOT NULL
);


ALTER TABLE db.sample OWNER TO "public-transport-stats";

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

CREATE INDEX by_scheduled ON db.sample USING btree (year, month, day, hour, minute);

ALTER TABLE db.sample CLUSTER ON by_scheduled;


--
-- Name: fki_satio; Type: INDEX; Schema: db; Owner: public-transport-stats
--

CREATE INDEX fki_satio ON db.station USING btree (parent);


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
-- Name: TABLE operator; Type: ACL; Schema: db; Owner: public-transport-stats
--

GRANT SELECT ON TABLE db.operator TO "public-transport-stats-read";


--
-- Name: TABLE product_type; Type: ACL; Schema: db; Owner: public-transport-stats
--

GRANT SELECT ON TABLE db.product_type TO "public-transport-stats-read";


--
-- Name: TABLE response_log; Type: ACL; Schema: db; Owner: public-transport-stats
--

GRANT SELECT ON TABLE db.response_log TO "public-transport-stats-read";


--
-- Name: TABLE sample; Type: ACL; Schema: db; Owner: public-transport-stats
--

GRANT SELECT ON TABLE db.sample TO "public-transport-stats-read";


--
-- Name: TABLE station; Type: ACL; Schema: db; Owner: public-transport-stats
--

GRANT SELECT ON TABLE db.station TO "public-transport-stats-read";


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: db; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA db REVOKE ALL ON SEQUENCES  FROM postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA db GRANT SELECT ON SEQUENCES  TO "public-transport-stats-read";


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: db; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA db REVOKE ALL ON TABLES  FROM postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA db GRANT SELECT ON TABLES  TO "public-transport-stats-read";


--
-- PostgreSQL database dump complete
--

