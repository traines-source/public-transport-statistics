# Public Transport Statistics

Collecting traffic of realtime public transport APIs to calculate statistics about delays, cancellations, etc. of public transport (currently mainly in Germany). With a special focus on delay distributions (delay histograms) and conditional probabilities, to answer questions like "Given this train is currently delayed by 20 minutes and is thus projected to depart in 50 minutes from now, what departure delay (i.e. what delay distribution) will it finally have?"

## Access the results

(Currently Germany (DB) only)

* Dashboard: https://stats.traines.eu
* DB Querying (SQL): https://query.stats.traines.eu (user: guest-read@traines.eu pass: ptstats)
* For programmatic access, please get in touch.
* For access to the raw data (about 70GB per month), please get in touch.

## Core principle

### Example for one train leaving one station

| Sample #					| scheduled_time	| projected_time	| delay_minutes		| sample_time		| ttl_minutes		|
| -----						| -----				| -----				| -----				| -----				| -----				|
| Sample 1 					| 2023-01-01 17:10	| 2023-01-01 17:10	| NULL				| 2023-01-01 16:00	| 70				|
| Sample 2					| 2023-01-01 17:10	| 2023-01-01 17:11	| 1					| 2023-01-01 17:00	| 11				|
| Sample 3 (latest_sample) 	| 2023-01-01 17:10	| 2023-01-01 17:27	| 17				| 2023-01-01 17:25	| 2					|
| Sample 4					| 2023-01-01 17:10	| 2023-01-01 17:10	| NULL				| 2023-01-01 17:40	| -30				|


We get multiple "samples", i.e. records of status from different points in time, for one arrival/departure of a train/bus/etc. at a station, e.g. ICE 100 scheduled to leave Berlin Hbf at 2023-01-01 17:10 (`scheduled_time`). Possibly at first (Sample 1), we do not get any live data, because the train has not yet departed from its origin station (`delay_minutes` is NULL). When we get closer to departure, i.e. the difference between `sample_time` and `projected_time` that is `ttl_minutes` diminishes, at some point we should get live data (Sample 2 and 3, `delay_minutes` not NULL). The delay will change over time. After the train has departed, for many providers, live data will be deleted for that departure (Sample 4, `delay_minutes` is NULL again).

We qualify as "latest sample" the last sample (latest `sample_time`) that still has live data (`delay_minutes` set or trip cancelled, Sample 3 here). This is taken to be the actual final delay of this train at this station. The accuracy of that assumption depends on how close to the actual departure the sample was taken (`ttl_minutes`). More on that below (`latest_sample_ttl_bucket`).

## Core tables/views

### sample

The table where all samples are recorded. Many fields are based on [FPTF (Friendly Public Transport Format)](https://github.com/public-transport/friendly-public-transport-format), which is also the intermediate format for ingestion.

* id: autoincrement id
* scheduled_time: FPTF plannedWhen/plannedArrival/plannedDeparture, time when arrival/departure was originally scheduled
* projected_time: FPTF when/arrival/departure, time when arrival/departure is currently projected based on delay. Null only when cancelled. When delay_minutes is null, this field is still set (then equal to scheduled_time)
* delay_minutes: Null when no realtime data available or when cancelled. Realtime data usually gets nulled by the source system a few minutes after actual arrival/departure. Negative when too early.
* cancelled: Either this stop or the entire trip was cancelled.
* sample_time: When this sample was taken, i.e. when the data contained in this row was current.
* ttl_minutes: Difference between sample_time and projected_time. Positive when arrival/departure was in the future at sample time. Negative when it was in the past past.
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
* load_factor_id: FK load_factor, FPTF loadFactor
* response_id: FK response_log

### sample_histogram

First aggregation step, this is basically an n-dimensional histogram (n being the number of dimension columns) that you can sum over to get coarser stats (but be careful how, see queries below).

* scheduled_time by hour
* year, month, day, day_of_week, hour: extracted from scheduled_time in GMT
* product_type_id
* station_id
* operator_id
* is_departure
* prior_ttl_bucket: time from sample_time until projected_time according to prior_delay, NULL without prior delay (i.e. actual final delay distribution).
* prior_delay_bucket: prior delay, NULL without prior delay or for stops not yet having live data.
* latest_sample_ttl_bucket: Indicator for accuracy of latest_sample_delay. Hopefully never NULL (INNER JOIN)
* latest_sample_delay_bucket: when prior_delay_bucket set: relative delay, else absolute delay. NULL only when stop cancelled.  '(,)' when stop cancelled but substitution trip running.
* sample_count: number of samples falling in that bucket.
* total_sample_count: sum of sample_count grouped by all fields except operator_id and latest_sample_delay_bucket. Do not sum over this!

Buckets are using the postgres range type with familiar maths notation like `[-10,10)`.

Revisiting the question from above: Given a train is currently delayed by `prior_delay_bucket` minutes and is thus projected to depart in `prior_ttl_bucket` minutes from now, what departure delay (i.e. what delay distribution `latest_sample_delay_bucket`) will it finally have? "Finally" being defined by `latest_sample_ttl_bucket`, since we do not actually have final delay times. As such, we take the "latest sample" for each trip-station-scheduled_time-is_departure combination we have and record the duration from this sample_time to the final projected_time. It is advisable to restrict `latest_sample_ttl_bucket` to something like `(-10,10]` to avoid skewing the delay distribution due to multiple reasons:

* if the delay is sampled too early before actual departure/arrival, delays might be underestimated (I think, because delays tend to increase more than decrease during the course of a trip)
* if the delay is sampled much before actual departure/arrival, when for most trips, live data is not yet available, cancelled trips are overrepresented (since they are usually known earlier and only trips with live data or cancelled flag set are kept as "latest sample")
* if the delay is sampled too far after the actual departure/arrival, cancelled trips are overrepresented, since for some providers (e.g. Deutsche Bahn), delays get nulled after a couple of minutes and as such these samples don't qualify as "latest sample", but the cancelled ones do indefinitely.

For more insight on `latest_sample_ttl_bucket`, check out the "Realtime data deletion" panel in the ["Ops" dashboard](https://stats.traines.eu/d/bnoIAJFVz/ops?orgId=1). 

## Core queries

### Filtering latest_samples

```
SELECT DISTINCT ON(trip_id, scheduled_time, station_id, is_departure)
trip_id, scheduled_time, station_id, is_departure,
ttl_minutes, id, sample_time,
CASE
	WHEN cancelled THEN NULL
	ELSE delay_minutes
END AS delay_minutes,
CASE
	WHEN cancelled AND substitute_running.remarks_hash IS NOT NULL THEN true
	WHEN cancelled THEN false
	ELSE NULL
END AS cancelled_with_substitute
FROM db.sample s
LEFT JOIN (
	SELECT DISTINCT remarks_hash
	FROM (
		SELECT remarks_hash, jsonb_array_elements(remarks) AS r
		FROM db.remarks r
	) AS d
	WHERE
	r->>'code' = 'alternative-trip'
	OR r->>'text' LIKE '%CE 29%' 
	OR r->>'text' LIKE '%C 29%'
	OR r->>'text' LIKE '%Ersatzfahrt%'
	OR r->>'text' LIKE '%substitute%'
) AS substitute_running
ON substitute_running.remarks_hash = s.remarks_hash
WHERE delay_minutes IS NOT NULL OR cancelled
ORDER BY trip_id, scheduled_time, station_id, is_departure, sample_time DESC, ttl_minutes ASC 
```

Since we do not actually know the final delay of a trip at a station, we record the latest samples for each trip-station-scheduled_time-is_departure combination and take that as ground truth. We can later restrict our statistics to latest samples that were taken not too far from final departure/arrival (cf. `latest_sample_ttl_bucket`).

For cancelled trips, we detect based on the recorded remarks whether a substitute trip is running and as such, from a traveler's perspective, whether the trip is not actually cancelled.

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
		WHEN latest_sample.cancelled_with_substitute = true THEN '(,)'::int4range
		WHEN latest_sample.id = s.id OR s.delay_minutes IS NULL THEN db.delay_bucket_range(latest_sample.delay_minutes)
		ELSE db.delay_bucket_range(latest_sample.delay_minutes-s.delay_minutes) 
	END AS latest_sample_delay_bucket, -- relative delay with prior delay, else absolute delay. NULL when stop cancelled. '(,)' when stop cancelled but substitution trip running.
	COUNT(*) as sample_count
	FROM db.sample AS s
	INNER JOIN db.latest_sample
	ON s.trip_id = latest_sample.trip_id
	AND s.scheduled_time = latest_sample.scheduled_time
	AND s.station_id = latest_sample.station_id
	AND s.is_departure = latest_sample.is_departure
	WHERE NOT s.cancelled OR latest_sample.id = s.id
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
WHERE NOT l.latest_sample_delay_bucket <@ '(,-5)'::int4range OR l.latest_sample_delay_bucket IS NULL
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
	AND latest_sample_delay_bucket IS NOT NULL AND latest_sample_delay_bucket::text != '(,)'
	GROUP BY year, month, operator_id, latest_sample_delay_bucket
) AS s
NATURAL JOIN db.operator o
JOIN db.official_delay_stats_operators oo ON oo.operator = o.id
JOIN db.official_delay_stats od ON od.category = oo.category AND od.year = s.year AND od.month = s.month
GROUP BY s.year, s.month, od.category, od.delay_percentage_5min, od.delay_percentage_15min

```
If you find more efficient or simpler variants of these queries (that are still (or more?) correct), let me know!

## Related work

* Thanks to [@derhuerst](https://github.com/derhuerst) for his data support (and of course his work on [hafas-client](https://github.com/public-transport/hafas-client/) and [FPTF](https://github.com/public-transport/friendly-public-transport-format) and...).
* https://github.com/dystonse/dystonse – DYnamic STochastic ONline SEarch in public transport networks, with realtime data collection for statistics, but discontinued
* https://www.zugfinder.net/ – connecting train probabilities, delay statistics
* http://puenktlichkeit.ch/ – delays in Switzerland
* https://verspaetungen-sbb-zuege.opendata.iwi.unibe.ch/visualization.html – simple delay distributions Switzerland
* https://observablehq.com/@alexmasselot/marey-like-timetable-geneva-lausanne, https://observablehq.com/@alexmasselot/mapping-swiss-trains-delays-over-one-day/2 – delays in a time-space diagram and on a map
* https://tuprints.ulb.tu-darmstadt.de/6227/ – Computing Highly Reliable Train Journeys
* https://drops.dagstuhl.de/opus/volltexte/2012/3701/ – Reliability and Delay Distributions of Train Connections
* https://www.transit.land/ – Collection of GTFS(-RT) feeds (historic availability of realtime data?)
* https://www.dkriesel.com/blog/2019/1229_video_und_folien_meines_36c3-vortrags_bahnmining – D. Kriesel's BahnMining
* More? Let me know.
