/**
 * Ingest the Bahn-Vorhersage "parsed train delays" parquet files
 * (https://bahnvorhersage.de/opendata, daily files grouped by service_date)
 * into a PTS schema (e.g. de_bahnvorhersage, see schema/schema.de_bahnvorhersage.sql)
 * and aggregate them into the sample_histogram_* tables.
 *
 * Every parquet row (= one prognosis update for one arrival/departure) becomes one sample.
 * Since a daily file contains all updates of all trips starting on that day, every file is
 * self-contained and the samples can be aggregated (and deleted) right after ingestion.
 *
 * Usage:
 *   node ingest/ingest-parquet.js                       # all enabled entries of conf.parquetTargets
 *   node ingest/ingest-parquet.js --schema de_bahnvorhersage --matches '/path/to/2024/*.parquet'
 *
 * Options (override the config entry):
 *   --schema <schema>            target schema
 *   --matches <glob>             parquet files to ingest (processed in lexical order)
 *   --source-id <n>              source id stored in response_log
 *   --aggregate-every <n>        call refresh_histograms_and_cleanup_samples after every n ingested files (default 7)
 *   --no-aggregate               only load samples, do not aggregate
 *
 * Files already recorded in <schema>.response_log (by file name + size) are skipped,
 * so the script can be interrupted and restarted at any time.
 */

import { parseArgs } from 'node:util'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import fs from 'node:fs'
import path from 'node:path'
import glob from 'glob'
import md5 from 'md5'
import { asyncBufferFromFile, parquetMetadataAsync, parquetReadObjects } from 'hyparquet'
import { compressors } from 'hyparquet-compressors'

import db from './db.js'
import { conf } from './read-conf.js'

const RESPONSE_TYPE_PARQUET_FILE = 20;
const MAX_ABS_TTL_MINUTES = 24*60; // same as load.js analyzeSample
const SMALLINT_MAX = 32767;
// each file contains all samples of its trips -> aggregate everything that is in the sample table
const DEFAULT_FREEZE_INTERVAL = '-1 day';

const COLUMNS = ['trip_id', 'time_schedule', 'time_real', 'update_timestamp', 'delay', 'is_cancelled', 'is_arrival',
    'is_regional', 'category', 'number', 'line', 'operator', 'stop_id', 'stop_sequence', 'lat', 'lon'];

const NATIONAL_EXPRESS = new Set(['ICE', 'ECE', 'RJX', 'TGV']);
const FERRY = new Set(['FÄ', 'F', 'SCHIFF', 'KAT']);
const TRAM = new Set(['STR', 'TRAM']);
const TAXI = new Set(['AST', 'ALT', 'RFB', 'TAXI']);

/** maps to the product_type names of the de_db (HAFAS) schema */
const productType = (category, line, isRegional) => {
    const c = (category || '').toUpperCase();
    const l = (line || '').toUpperCase();
    if (c === 'BUS') return 'bus';
    if (FERRY.has(c)) return 'ferry';
    if (TRAM.has(c)) return 'tram';
    if (c === 'U') return 'subway';
    if (TAXI.has(c)) return 'taxi';
    if (!isRegional) return NATIONAL_EXPRESS.has(c) ? 'nationalExpress' : 'national';
    if (c === 'S' || /^S\d/.test(l)) return 'suburban';
    if (c === 'RE' || c === 'IRE' || /^I?RE\d/.test(l)) return 'regionalExpress';
    return 'regional';
}

/** HAFAS-like line names, e.g. "ICE 17", "RE 5", "S 2", "RB 42a" */
const lineName = (category, line, number) => {
    if (!line || line === number) return category ? category+' '+number : number;
    const m = /^([^\d\s]+)\s*(.*)$/.exec(line);
    if (m) return m[2] ? m[1]+' '+m[2] : m[1];
    return category ? category+' '+line : line;
}

const sanitize = (s) => s == null ? null : String(s).replace(/[\t\n\r\\]/g, ' ');

const parseCli = () => {
    const { values } = parseArgs({
        options: {
            'schema': { type: 'string' },
            'matches': { type: 'string' },
            'source-id': { type: 'string' },
            'aggregate-every': { type: 'string' },
            'no-aggregate': { type: 'boolean', default: false },
        }
    });
    return values;
}

const getTargets = (cli) => {
    let targets = (conf.parquetTargets || []).filter(t => !t.disabled);
    if (cli.schema) {
        const fromConf = (conf.parquetTargets || []).find(t => t.schema == cli.schema) || {schema: cli.schema};
        targets = [{...fromConf}];
    }
    for (const t of targets) {
        if (cli.matches) t.matches = cli.matches;
        if (cli['source-id'] != undefined) t.sourceid = parseInt(cli['source-id']);
        if (cli['aggregate-every'] != undefined) t.aggregateEvery = parseInt(cli['aggregate-every']);
        if (cli['no-aggregate']) t.aggregate = false;
        t.sourceid = t.sourceid || 0;
        t.aggregateEvery = t.aggregateEvery || 7;
        t.aggregate = t.aggregate !== false;
        t.freezeInterval = t.freezeInterval || DEFAULT_FREEZE_INTERVAL;
        if (!t.matches) throw new Error('No "matches" glob given for schema '+t.schema);
    }
    return targets;
}

const fileHash = (file) => {
    const stat = fs.statSync(file);
    return md5(path.basename(file)+':'+stat.size);
}

const loadMaps = async (schema) => {
    const operators = {};
    for (const r of (await db.query('SELECT operator_id, id FROM '+schema+'.operator')).rows) operators[r.id] = r.operator_id;
    const productTypes = {};
    for (const r of (await db.query('SELECT product_type_id, name FROM '+schema+'.product_type')).rows) productTypes[r.name] = r.product_type_id;
    const stations = new Set((await db.query('SELECT station_id FROM '+schema+'.station')).rows.map(r => r.station_id));
    return { operators, productTypes, stations };
}

const ensureOperators = async (schema, file, md, maps) => {
    const missing = new Set();
    let rowStart = 0;
    for (const rg of md.row_groups) {
        const rowEnd = rowStart + Number(rg.num_rows);
        const rows = await parquetReadObjects({ file, metadata: md, compressors, columns: ['operator'], rowStart, rowEnd });
        for (const r of rows) {
            if (r.operator != null && maps.operators[r.operator] == undefined) missing.add(r.operator);
        }
        rowStart = rowEnd;
    }
    if (missing.size > 0) {
        const ids = [...missing];
        const res = await db.query('INSERT INTO '+schema+'.operator (id, name) SELECT id, id FROM UNNEST($1::text[]) AS id ON CONFLICT (id) DO UPDATE SET id = EXCLUDED.id RETURNING operator_id, id', [ids]);
        for (const r of res.rows) maps.operators[r.id] = r.operator_id;
    }
}

const ensureProductTypes = async (schema, maps) => {
    const names = ['bus', 'subway', 'tram', 'regional', 'suburban', 'nationalExpress', 'national', 'regionalExpress', 'ferry', 'taxi'];
    const missing = names.filter(n => maps.productTypes[n] == undefined);
    if (missing.length > 0) {
        const res = await db.query('INSERT INTO '+schema+'.product_type (name) SELECT UNNEST($1::text[]) RETURNING product_type_id, name', [missing]);
        for (const r of res.rows) maps.productTypes[r.name] = r.product_type_id;
    }
}

async function* tsvChunks(file, md, maps, responseId, ctrs, newStations) {
    let rowStart = 0;
    for (const rg of md.row_groups) {
        const rowEnd = rowStart + Number(rg.num_rows);
        const rows = await parquetReadObjects({ file, metadata: md, compressors, columns: COLUMNS, rowStart, rowEnd });
        rowStart = rowEnd;
        const lines = [];
        for (const r of rows) {
            ctrs.rows++;
            if (!r.update_timestamp) {
                // stop events that never received any realtime update (plan only)
                ctrs.missingSampleTime++;
                continue;
            }
            if (!r.time_schedule || r.stop_id == null || r.trip_id == null) {
                ctrs.missingFields++;
                continue;
            }
            const projected = r.time_real || r.time_schedule;
            const ttl = Math.round((projected.getTime() - r.update_timestamp.getTime())/60000);
            if (Math.abs(ttl) > MAX_ABS_TTL_MINUTES) {
                ctrs.outside24h++;
                continue;
            }
            let delay = r.delay == null ? null : Math.round(r.delay/60);
            if (delay != null && Math.abs(delay) > SMALLINT_MAX) {
                ctrs.delayOutOfRange++;
                continue;
            }
            if (r.is_cancelled) {
                ctrs.cancelled++;
                delay = null;
            }
            if (delay > 12*60) ctrs.delayGreater12h++;
            else if (delay < -50) ctrs.delayLargeNegative++;

            const stationId = String(r.stop_id);
            if (!maps.stations.has(stationId) && r.lat != null && r.lon != null) {
                maps.stations.add(stationId);
                newStations.push({ id: stationId, lon: r.lon, lat: r.lat });
            }
            const category = sanitize(r.category);
            const number = sanitize(r.number);
            const pt = productType(category, r.line, r.is_regional);
            ctrs.productTypes[pt] = (ctrs.productTypes[pt] || 0) + 1;

            lines.push(db.sampleToTSV({
                scheduled_time: r.time_schedule,
                scheduled_duration_minutes: null,
                projected_duration_minutes: null,
                delay_minutes: delay,
                cancelled: !!r.is_cancelled,
                sample_time: r.update_timestamp,
                ttl_minutes: ttl,
                trip_id: String(r.trip_id),
                line_name: lineName(category, sanitize(r.line), number),
                line_fahrtnr: number,
                product_type_id: maps.productTypes[pt],
                product_name: category,
                station_id: stationId,
                operator_id: r.operator != null ? maps.operators[r.operator] : null,
                is_departure: !r.is_arrival,
                remarks_hash: null,
                stop_number: r.stop_sequence,
                load_factor_id: null,
                response_id: responseId,
                prognosis_type_id: null,
            }));
            ctrs.persistedSamples++;
        }
        if (lines.length > 0) yield lines.join('');
    }
}

const upsertStations = async (schema, stationNamesFrom, newStations) => {
    if (newStations.length == 0) return;
    const nameJoin = stationNamesFrom
        ? ' LEFT JOIN '+stationNamesFrom+'.station n ON n.station_id = v.id'
        : '';
    const name = stationNamesFrom ? 'COALESCE(n.name, v.id)' : 'v.id';
    await db.query(
        'INSERT INTO '+schema+'.station (station_id, lonlat, name) SELECT v.id, point(v.lon, v.lat), '+name
        +' FROM UNNEST($1::text[], $2::float8[], $3::float8[]) AS v(id, lon, lat)'+nameJoin
        +' ON CONFLICT (station_id) DO NOTHING',
        [newStations.map(s => s.id), newStations.map(s => s.lon), newStations.map(s => s.lat)]
    );
}

const ingestFile = async (target, filePath, hash, maps) => {
    const start = performance.now();
    const file = await asyncBufferFromFile(filePath);
    const md = await parquetMetadataAsync(file);
    const ctrs = { file: path.basename(filePath), rows: 0, persistedSamples: 0, missingSampleTime: 0, missingFields: 0, outside24h: 0, delayOutOfRange: 0,
        cancelled: 0, delayGreater12h: 0, delayLargeNegative: 0, newStations: 0, productTypes: {} };

    await ensureOperators(target.schema, file, md, maps);

    const newStations = [];
    try {
        await db.begin();
        const res = await db.query('INSERT INTO '+target.schema+'.response_log (hash, type, response_time, source, sample_count, response_time_estimated, sample_time_estimated, ctrs)'
            +' VALUES ($1, $2, now(), $3, 0, false, false, \'{}\') RETURNING response_id', [hash, RESPONSE_TYPE_PARQUET_FILE, target.sourceid]);
        const responseId = res.rows[0].response_id;

        await pipeline(Readable.from(tsvChunks(file, md, maps, responseId, ctrs, newStations)), db.streamInsertSamples(target.schema));

        await upsertStations(target.schema, target.stationNamesFrom, newStations);
        ctrs.newStations = newStations.length;
        ctrs.seconds = Math.round((performance.now()-start)/1000);
        await db.query('UPDATE '+target.schema+'.response_log SET sample_count = $1, ctrs = $2 WHERE response_id = $3', [ctrs.persistedSamples, ctrs, responseId]);
        await db.commit();
    } catch (err) {
        await db.rollback();
        for (const s of newStations) maps.stations.delete(s.id);
        throw err;
    }
    return ctrs;
}

const aggregate = async (target) => {
    const start = performance.now();
    console.log(new Date().toISOString(), 'aggregating samples into histograms...');
    await db.query('CALL '+target.schema+'.refresh_histograms_and_cleanup_samples($1::interval)', [target.freezeInterval]);
    console.log(new Date().toISOString(), 'aggregation done in', Math.round((performance.now()-start)/1000), 's');
}

const processTarget = async (target) => {
    const files = glob.sync(target.matches).sort();
    console.log(new Date().toISOString(), 'schema', target.schema, ':', files.length, 'files matching', target.matches);

    const done = new Set((await db.query('SELECT hash::text FROM '+target.schema+'.response_log WHERE type = $1', [RESPONSE_TYPE_PARQUET_FILE])).rows.map(r => r.hash.replace(/-/g, '')));
    const maps = await loadMaps(target.schema);
    await ensureProductTypes(target.schema, maps);

    let pendingSamples = (await db.query('SELECT EXISTS (SELECT 1 FROM '+target.schema+'.sample)')).rows[0].exists;
    let sinceAggregation = 0;
    for (const filePath of files) {
        const hash = fileHash(filePath);
        if (done.has(hash)) {
            console.log('skipping already ingested', filePath);
            continue;
        }
        const ctrs = await ingestFile(target, filePath, hash, maps);
        done.add(hash);
        console.log(new Date().toISOString(), JSON.stringify(ctrs));
        pendingSamples = true;
        sinceAggregation++;
        if (target.aggregate && sinceAggregation >= target.aggregateEvery) {
            await aggregate(target);
            pendingSamples = false;
            sinceAggregation = 0;
        }
    }
    if (target.aggregate) {
        if (pendingSamples) await aggregate(target);
        console.log(new Date().toISOString(), 'refreshing by_month and without_time aggregations...');
        await db.query('CALL '+target.schema+'.refresh_histograms_aggregations()');
        console.log(new Date().toISOString(), 'done.');
    }
}

try {
    const targets = getTargets(parseCli());
    if (targets.length == 0) console.log('No parquet targets configured (conf.parquetTargets) or given (--schema).');
    for (const target of targets) {
        await processTarget(target);
    }
} catch (err) {
    console.error(err);
    process.exitCode = 1;
} finally {
    db.disconnect();
}
