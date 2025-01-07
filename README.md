# Public Transport Statistics

Collecting traffic of realtime public transport APIs and GTFS-RT feeds to calculate statistics about delays, cancellations, etc. of public transport. With a special focus on delay distributions (delay histograms) and conditional probabilities, to answer questions like "Given this train is currently delayed by 20 minutes and is thus projected to depart in 50 minutes from now, what departure delay (i.e. what delay distribution) will it finally have?"

## Access the results

(Currently Germany and Switzerland only; Belgium, France, Netherlands TBD)

* Dashboard: https://stats.traines.eu
* DB Querying (SQL): https://query.stats.traines.eu (user: guest-read@traines.eu pass: ptstats)
* For programmatic access, please get in touch.

## Data sources

* GTFS and GTFS-RT feeds of Belgium, France, Germany, Switzerland and the Netherlands (in most cases partial coverage, to be investigated), the archived data since 03/2023 is available at http://mirror.traines.eu (about 70 GB per month). There is also a public live mirror of the German DELFI GTFS-RT feed at https://stc.traines.eu/mirror/german-delfi-gtfs-rt/.
* If you know of more at least country-level european GTFS-RT feeds (I know of Norway), let me know.
* Traffic of realtime public transport APIs (from [TSTP](https://tespace.traines.eu) among others). For access to the raw data since 10/2022 (about 20 GB per month), please get in touch.
* [Official DB Haltestellendaten](https://data.deutschebahn.com/dataset/data-haltestellen.html) and other data sources for [-> station mapping](https://github.com/traines-source/db-hafas-gtfs-stops-mapping).

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
* scheduled_duration_minutes: How long this connection takes to the next stop according to schedule (not always available).
* projected_duration_minutes: How long this connection takes to the next stop according to current prediction (Not always available).
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
* (destination_provenance_id: Destination if is_departure, provenance if NOT is_departure.)
* (scheduled_platform: FPTF plannedPlatform)
* (projected_platform: FPTF platform)
* load_factor_id: FK load_factor, FPTF loadFactor
* response_id: FK response_log

### sample_histogram

First aggregation step, this is basically an n-dimensional histogram (n being the number of dimension columns) that you can sum over to get coarser stats (but be careful how, see queries below). In order to fight the curse of dimensionality, different incremental aggregations are created (`sample_histogram_by_day`, `sample_histogram_by_hour`, `sample_histogram_by_station`). By default, the full sample table and sample_histogram are not kept anymore to save storage! 

* scheduled_time by hour
* year, month, day, day_of_week, hour: extracted from scheduled_time in GMT
* line_name
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

### Filtering latest_samples and first aggregation to sample_histogram

See procedure [refresh_histograms_and_cleanup_samples()](https://github.com/traines-source/public-transport-statistics/blob/master/schema/schema.de_db.sql#L144). This procedure will be triggered automatically when ingesting. The procedure refresh_histograms_aggregations() can be triggered manually to update the aggregations `sample_histogram_without_time` and `sample_histogram_by_month` that are used by the dashboard for faster querying.

Since we do not actually know the final delay of a trip at a station, we record the latest samples for each trip-station-scheduled_time-is_departure combination and take that as ground truth. We can later restrict our statistics to latest samples that were taken not too far from final departure/arrival (cf. `latest_sample_ttl_bucket`).

For cancelled trips, we detect based on the recorded remarks whether a substitute trip is running and as such, from a traveler's perspective, whether the trip is not actually cancelled.

### Dashboard queries

See the [dashboard](https://stats.traines.eu/) and inspect panels.

## Related work

* Thanks to [@derhuerst](https://github.com/derhuerst) for his data support (and of course his work on [hafas-client](https://github.com/public-transport/hafas-client/) and [FPTF](https://github.com/public-transport/friendly-public-transport-format) and...).
* https://github.com/traines-source/stochastic-journey-strategies - stochastic routing based on these statistics
* https://github.com/dystonse/dystonse – DYnamic STochastic ONline SEarch in public transport networks, with realtime data collection for statistics, but discontinued
* http://wahrscheinlich-ankommen.de/
* https://bahnvorhersage.de/
* https://www.zugfinder.net/ – connecting train probabilities, delay statistics
* http://puenktlichkeit.ch/ – delays in Switzerland
* https://verspaetungen-sbb-zuege.opendata.iwi.unibe.ch/visualization.html – simple delay distributions Switzerland
* https://observablehq.com/@alexmasselot/marey-like-timetable-geneva-lausanne, https://observablehq.com/@alexmasselot/mapping-swiss-trains-delays-over-one-day/2 – delays in a time-space diagram and on a map
* https://tuprints.ulb.tu-darmstadt.de/6227/ – Computing Highly Reliable Train Journeys
* https://drops.dagstuhl.de/opus/volltexte/2012/3701/ – Reliability and Delay Distributions of Train Connections
* https://www.transit.land/ – Collection of GTFS(-RT) feeds (historic availability of realtime data?)
* https://www.dkriesel.com/blog/2019/1229_video_und_folien_meines_36c3-vortrags_bahnmining – D. Kriesel's BahnMining
* More? Let me know.
