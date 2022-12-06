# Public Transport Statistics

Collecting traffic of realtime public transport APIs to calculate statistics about delays, cancellations, etc. of public transport (currently mainly in Germany). With a special focus on delay distributions (delay histograms) and conditional probabilities, to answer questions like "Given this train is currently delayed by 20 minutes and is thus projected to depart in 50 minutes from now, what departure delay (i.e. what delay distribution) will it finally have?"

## Access the results

(Currently Germany (DB) only)

* Dashboard: https://stats.traines.eu
* DB Querying (SQL): https://query.stats.traines.eu (user: guest-read@traines.eu pass: ptstats)
* For programmatic access, please get in touch.
* For access to the raw data (about 70GB per month), please get in touch.

## Core tables/views

### sample

The table where all samples are recorded. Many fields are based on [FPTF (Friendly Public Transport Format)](https://github.com/public-transport/friendly-public-transport-format), which is also the intermediate format for ingestion.

* id: autoincrement id
* scheduled_time: time when arrival/departure was originally scheduled
* projected_time: time when arrival/departure is currently projected based on delay. Null only when cancelled. When delay_minutes is s field is still set (then equal to scheduled_time)
* delay_minutes: Null when no realtime data available or when cancelled. Realtime data usually gets deleted by the source system a few ure. Negative when too early.
* cancelled: Either this stop or the entire trip was cancelled.
* sample_time: When this sample was taken, i.e. when the data contained in this row was current.
* ttl_minutes: Difference between sample_time and projected_time. Positive when arrival/departure was in the future at sample time. past.
* trip_id: FPTF tripId
* line_name: FPTF line.name
* line_fahrtnr: FPTF line.fahrtNr
* product_type_id: FK product_type, FPTF line.product
* product_name: FPTF line.productName
* station_id: EVA number
* operator_id: FK operator
* is_departure: Indicates arrival/departure.
* remarks_hash: FK remarks, FPTF remarks.
* stop_number: Can be used to indicate how many stops came before this stop on this trip.
* destination_provenance_id: Destination if is_departure, provenance if NOT is_departure.
* scheduled_platform: FPTF plannedPlatform
* projected_platform: FPTF platform
* load_factor_id: FK load_factor
* response_id: FK response_log

### sample_histogram

First aggregation step, this is basically an n-dimensional histogram (n being the number of dimension columns) that you can sum over to get coarser stats (but be careful how, see queries below).

* scheduled_time
* year, month, day, day_of_week, hour: extracted from scheduled_time in GMT
* product_type_id
* station_id
* operator_id
* is_departure
* prior_ttl_bucket: time from sample_time until projected_time according to prior_delay, NULL without prior delay (i.e. actual final delay distribution).
* prior_delay_bucket: prior delay, NULL without prior delay or for stops not yet having live data or being cancelled.
* latest_sample_ttl_bucket: hopefully never NULL (INNER JOIN)
* latest_sample_delay_bucket: when prior_delay_bucket set: relative delay, else absolute delay. NULL only when stop cancelled.
* sample_count: number of samples falling in that bucket.
* total_sample_count: sum of sample_count grouped by all fields except latest_sample_delay_bucket. Do not sum over this!

Buckets are using the postgres range type with familiar maths notation like `[-10,10)`.

Revisiting the question from above: Given a train is currently delayed by `prior_delay_bucket` and is thus projected to depart in `prior_ttl_bucket` from now, what departure delay (i.e. what delay distribution `latest_sample_delay_bucket`) will it finally have? "Finally" being defined by `latest_sample_ttl_bucket`, since we do not actually have final delay times. As such, we take the "latest sample" for each trip-station-scheduled_time-is_departure combination we have and record the distance from this sample_time to the final projected_time. It is advisable to restrict `latest_sample_ttl_bucket` to something like `(-10,10]` to avoid skewing the delay data due to multiple reasons:

* if the delay is sampled too early before actual departure/arrival, delays might be underestimated (I think, because delays tend to increase more than decrease during the course of a trip)
* if the delay is sampled much before actual departure/arrival, when for most trips, live data is not yet available, cancelled trips are overrepresented (since they are usually known earlier and only trips with live data or cancelled flag set are kept as "latest sample")
* if the sampled delay is too far after the actual departure, cancelled trips are overrepresented, since for some providers (e.g. Deutsche Bahn), delays get deleted and as such these samples don't qualify as "latest sample", but the cancelled ones do indefinitely.

For more insight on `latest_sample_ttl_bucket`, check out the "Realtime data deletion" panel in the ["Ops" dashboard](https://stats.traines.eu/d/bnoIAJFVz/ops?orgId=1). 

## Core queries

### First aggregation to VIEW sample_histogram

```
SELECT r.scheduled_time,
    date_part('year', r.scheduled_time)::smallint AS year,
    date_part('month', r.scheduled_time)::smallint AS month,
    date_part('day', r.scheduled_time)::smallint AS day,
    date_part('dow', r.scheduled_time)::smallint AS day_of_week,
    date_part('hour', r.scheduled_time)::smallint AS hour,
    r.product_type_id,
    r.station_id,
    r.operator_id,
    r.is_departure,
    r.prior_ttl_bucket,
    r.prior_delay_bucket,
    r.latest_sample_ttl_bucket,
    r.latest_sample_delay_bucket,
    r.sample_count,
	SUM(sample_count) OVER (PARTITION BY 
	scheduled_time, product_type_id, station_id, is_departure,
	prior_delay_bucket, prior_ttl_bucket, latest_sample_ttl_bucket
) AS total_sample_count
FROM (
	SELECT date_trunc('hour'::text, s.scheduled_time) AS scheduled_time, product_type_id, s.station_id, s.operator_id, s.is_departure,
	CASE
		WHEN latest_sample.id = s.id THEN NULL
		ELSE db.ttl_bucket_range(s.ttl_minutes)
	END AS prior_ttl_bucket, -- NULL without prior delay
	CASE
		WHEN latest_sample.id = s.id THEN NULL
		ELSE db.delay_bucket_range(s.delay_minutes)
	END AS prior_delay_bucket, -- NULL without prior delay or for trains not yet having live data
	db.ttl_bucket_range(latest_sample.ttl_minutes) AS latest_sample_ttl_bucket, -- hopefully never NULL (INNER JOIN)
	CASE
		WHEN latest_sample.id = s.id OR s.delay_minutes IS NULL THEN db.delay_bucket_range(latest_sample.delay_minutes)
		ELSE db.delay_bucket_range(latest_sample.delay_minutes-s.delay_minutes) 
	END AS latest_sample_delay_bucket, -- relative delay with prior delay, else absolute delay. NULL only when stop cancelled.
	COUNT(*) as sample_count
	FROM db.sample AS s
	INNER JOIN (
		SELECT sample_time, trip_id, scheduled_time, station_id, is_departure,
		MIN(ttl_minutes) AS ttl_minutes, BOOL_OR(cancelled) AS cancelled, MAX(id) as id,
		CASE
			WHEN BOOL_OR(cancelled) THEN NULL
			ELSE MAX(delay_minutes)
		END AS delay_minutes
		FROM db.sample
		NATURAL JOIN (
			SELECT MAX(sample_time) AS sample_time, trip_id, scheduled_time, station_id, is_departure
			FROM db.sample
			WHERE delay_minutes IS NOT NULL OR cancelled
			GROUP BY trip_id, scheduled_time, station_id, is_departure
		) AS latest_live_sample
		GROUP BY sample_time, trip_id, scheduled_time, station_id, is_departure
	) AS latest_sample
	ON s.trip_id = latest_sample.trip_id
	AND s.scheduled_time = latest_sample.scheduled_time
	AND s.station_id = latest_sample.station_id
	AND s.is_departure = latest_sample.is_departure
	GROUP BY date_trunc('hour', s.scheduled_time), product_type_id, s.station_id, s.operator_id, s.is_departure,
	prior_delay_bucket, prior_ttl_bucket, latest_sample_delay_bucket, latest_sample_ttl_bucket
) AS r
```

### Dashboard: Relative histogram with prior_delay_bucket and prior_ttl_bucket by product_type

```
SELECT CASE WHEN l.latest_sample_delay_bucket IS NULL THEN 'cancelled' ELSE l.latest_sample_delay_bucket::text END as label, (sample_count/SUM(sample_count) OVER ()) AS percent_of_departures
FROM (
SELECT latest_sample_delay_bucket, SUM(sample_count) as sample_count
FROM ${schema}.sample_histogram
NATURAL JOIN ${schema}.product_type p
WHERE prior_ttl_bucket = '$prior_ttl_bucket'::int4range AND (CASE WHEN '$prior_delay_bucket' = 'Unknown' THEN prior_delay_bucket IS NULL ELSE prior_delay_bucket::text = '$prior_delay_bucket' END) AND is_departure AND latest_sample_ttl_bucket <@ '$latest_sample_ttl_bucket'::int4range
GROUP BY latest_sample_delay_bucket
) AS s
FULL OUTER JOIN (SELECT DISTINCT latest_sample_delay_bucket FROM ${schema}.sample_histogram WHERE latest_sample_delay_bucket IS NOT NULL) AS l ON l.latest_sample_delay_bucket = s.latest_sample_delay_bucket
--WHERE l.latest_sample_delay_bucket <@ '(-5,)'::int4range OR l.latest_sample_delay_bucket IS NULL
ORDER BY l.latest_sample_delay_bucket
```

### Dashboard: Absolute histogram by operator

```
SELECT CASE WHEN l.latest_sample_delay_bucket IS NULL THEN 'cancelled' ELSE l.latest_sample_delay_bucket::text END as label, (sample_count/SUM(sample_count) OVER ()) AS percent_of_arrivals
FROM (
SELECT latest_sample_delay_bucket, SUM(sample_count) as sample_count
FROM ${schema}.sample_histogram
NATURAL JOIN ${schema}.operator o
WHERE prior_ttl_bucket IS NULL AND NOT is_departure AND latest_sample_ttl_bucket <@ '$latest_sample_ttl_bucket'::int4range AND o.id = '$operator'
GROUP BY latest_sample_delay_bucket
) AS s
FULL OUTER JOIN (SELECT DISTINCT latest_sample_delay_bucket FROM ${schema}.sample_histogram WHERE latest_sample_delay_bucket IS NOT NULL) AS l ON l.latest_sample_delay_bucket = s.latest_sample_delay_bucket
WHERE l.latest_sample_delay_bucket <@ '(-5,)'::int4range OR l.latest_sample_delay_bucket IS NULL
ORDER BY l.latest_sample_delay_bucket
```

### Dashboard: Sanity check with official statistics

```
SELECT CONCAT(s.year::text, '-', s.month::text, ' ', od.category),
od.delay_percentage_5min,
ROUND(SUM(CASE WHEN latest_sample_delay_bucket <@ '(,5]'::int4range THEN sample_count ELSE 0 END)/SUM(sample_count)*100, 1) AS estimated_percentage_5min,
od.delay_percentage_15min,
ROUND(SUM(CASE WHEN latest_sample_delay_bucket <@ '(,15]'::int4range THEN sample_count ELSE 0 END)/SUM(sample_count)*100, 1) AS estimated_percentage_15min,
SUM(sample_count) AS sample_count
FROM (
	SELECT year, month, operator_id, latest_sample_delay_bucket, SUM(sample_count) as sample_count
	FROM db.sample_histogram
	NATURAL JOIN db.product_type
	WHERE prior_ttl_bucket IS NULL AND NOT is_departure AND latest_sample_ttl_bucket <@ '$latest_sample_ttl_bucket'::int4range
	AND latest_sample_delay_bucket IS NOT NULL
	GROUP BY year, month, operator_id, latest_sample_delay_bucket
) AS s
NATURAL JOIN db.operator o
JOIN db.official_delay_stats_operators oo ON oo.operator = o.id
JOIN db.official_delay_stats od ON od.category = oo.category AND od.year = s.year AND od.month = s.month
GROUP BY s.year, s.month, od.category, od.delay_percentage_5min, od.delay_percentage_15min

```
If you find more efficient or simpler variants of these queries (that are still correct), let me know!

## Credits

Thanks to @derhuerst for his data support (and of course his work on [hafas-client](https://github.com/public-transport/hafas-client/) and [FPTF](https://github.com/public-transport/friendly-public-transport-format) and...).
