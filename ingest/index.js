
import md5 from 'md5'
import {responseReader} from './read-response.js'
import {transformSamples} from './transform-samples.js'
import db from './db.js'
import {conf} from './read-conf.js'

const fallbackRtDiff = 120;


const validateResult = (result, ctrs) => {
    if (result.err) {
        ctrs.errors++;
        return false;
    }
    if (!result.type) {
        ctrs.unknownTypes++;
        if (result.expectedRtCount > 0) console.log('WARN: discarding response containing rtData', result.expectedRtCount);
        return false;
    }
    if (!result.response) {
        ctrs.emptyResponses++;
        return false;
    }
    return true;
}

const formatStation = (station) => {
    station.station_id = parseInt(station.station_id);
    if (station.parent) station.parent = parseInt(station.parent);
    station.lonlat = '('+station.lon+','+station.lat+')';
    return station;
}

const formatResponse = (result, hash, source, sampleCount) => {
    const typeIds = {
        'journeys': 0,
        'departures': 1,
        'arrivals': 2,
        'trip': 3,
        'refreshJourney': 4
    }
    return {
        hash: hash,
        type: typeIds[result.type],
        response_time: result.ts,
        source: source.sourceid,
        sample_count: sampleCount
    };
}

const formatSample = (sample) => {
    //sample.id
    sample.scheduled_time = new Date(sample.scheduled_time);
    sample.projected_time = new Date(sample.projected_time);
    sample.year = sample.scheduled_time.getUTCFullYear();
    sample.month = sample.scheduled_time.getUTCMonth()+1;
    sample.day = sample.scheduled_time.getUTCDate();
    sample.day_of_week = sample.scheduled_time.getUTCDay();
    sample.hour = sample.scheduled_time.getUTCHours();
    sample.minute = sample.scheduled_time.getUTCMinutes();
    //sample.trip_id
    //sample.line_name
    sample.line_fahrtnr = parseInt(sample.line_fahrtnr);
    //sample.product_type_id
    //sample.product_name
    sample.station_id = parseInt(sample.station_id);
    //sample.is_departure
    if (sample.delay_seconds != null) sample.delay_minutes = Math.round(sample.delay_seconds/60);
    sample.remarks = JSON.stringify(sample.remarks);
    sample.cancelled = !!sample.cancelled;
    //sample.stop_number
    if (sample.sample_time) sample.sample_time = new Date(sample.sample_time*1000);
    if (sample.sample_time) sample.ttl_minutes = Math.round((sample.projected_time.getTime()-sample.sample_time.getTime())/1000/60);
    //sample.operator_id
    if (sample.destination_provenance_id) sample.destination_provenance_id = parseInt(sample.destination_provenance_id);
    //sample.scheduled_platform
    //sample.projected_platform
    //sample.load_factor
    //sample.response_id
    return sample;
}

const setIfMissing = (foreignField, key, value) => {
    if (value && !foreignField.existing[key]) {
        foreignField.missing[key] = value;
    }
}

const insertMissing = async (foreignField, insertFct, schema) => {
    const missingList = Object.values(foreignField.missing);
    if (missingList.length > 0) {
        const newElements = await insertFct(schema, missingList);
        foreignField.existing = {
            ...foreignField.existing,
            ...newElements
        };
        foreignField.missing = {};
    }
}

const processSamples = async (target) => {
    const lastSuccessfuls = {
        0: '/mnt/lfs/traines-stc/teak-mirror/a.v5.db.transport.rest.ndjson1669417200.bz2',
        1: '/mnt/lfs/traines-stc/tstp-raw-mirror/data.20221125.log.gz.gz',
        2: '/mnt/lfs/traines-stc/tstp-mirror/responses.big1669381989.ndgz'
    }
    const hashes = [];
    const foreignFields = {
        operator: { existing: await db.getOperatorMap(target.schema), missing: {} },
        load_factor: { existing: await db.getLoadFactorMap(target.schema), missing: {} },
        product_type: { existing: await db.getProductTypeMap(target.schema), missing: {} }
    }
    for (const source of target.sources) {
        if (source.disabled) continue;

        const it = responseReader(source, lastSuccessfuls[source.sourceid]);

        let result;
        let rtDiffMin = 1000;
        let rtDiffMax = 0;
        let rtDiffSum = 0;
        let rtDiffCount = 0;
        const ctrs = {
            errors: 0,
            unknownTypes: 0,
            emptyResponses: 0,
            duplicates: 0,
            validResponses: 0,
            samples: 0,
            rtSamples: 0,
            incorrectRtCount: 0,
            persisted: 0,
            outside24h: 0,
            missingSampleTime: 0,
            skipped: 0
        }

        while ((result = await it.next())) {
            if (!validateResult(result, ctrs)) {
                continue;
            }
            const str = JSON.stringify(result.response);
            const hash = md5(str);
            if (hashes[hash]) {
                ctrs.duplicates++;
                continue;
            }
            hashes[hash] = source.sourceid;
            ctrs.validResponses++;

            const samples = transformSamples[result.type](result.response);
            const actualCount = samples.filter(e => e.delay_seconds != null).length;

            ctrs.samples += samples.length;
            ctrs.rtSamples += actualCount;
           
            if (result.expectedRtCount != actualCount) {
                ctrs.incorrectRtCount++;
                //console.log('incorrectRtCount:', result.expectedRtCount, actualCount, extracted.length, result.type);//, JSON.stringify(result.response), extracted);
                //break;
            }
            //console.log(extracted);
            //break;

            if (result.response?.realtimeDataFrom || result.response?.realtimeDataUpdatedAt) {
                rtDiffCount++;
                const diff = result.ts?.getTime()/1000-(result.response.realtimeDataFrom || result.response.realtimeDataUpdatedAt.legs);
                if (diff < rtDiffMin) rtDiffMin = diff;
                if (diff > rtDiffMax) rtDiffMax = diff;
                rtDiffSum += diff;
            }

            let relevantStations = {};
            let relevantSamples = [];
            for (let sample of samples) {
                if (!sample.sample_time) {
                    sample.sample_time = result.ts?.getTime()/1000-fallbackRtDiff;
                }
                sample = formatSample(sample);
                if (Math.abs(sample.ttl_minutes) > 24*60) {
                    ctrs.outside24h++;
                    continue;
                }
                if (!sample.sample_time) {
                    ctrs.missingSampleTime++;
                    continue;
                }                
                relevantSamples.push(sample);

                for (let station of sample.stations) {
                    relevantStations[station.station_id] = formatStation(station);
                }                

                setIfMissing(foreignFields.operator, sample.operator?.id, sample.operator);
                setIfMissing(foreignFields.load_factor, sample.load_factor, sample.load_factor);
                setIfMissing(foreignFields.product_type, sample.product_type, sample.product_type);
            }

            try {
                await db.begin();
                await insertMissing(foreignFields.operator, db.insertOperators, target.schema);
                await insertMissing(foreignFields.load_factor, db.insertLoadFactors, target.schema);
                await insertMissing(foreignFields.product_type, db.insertProductTypes, target.schema);
                const relevantStationList = Object.values(relevantStations);
                if (relevantStationList.length > 0) {
                    await db.upsertStations(target.schema, relevantStationList);
                }

                const responseId = await db.insertResponse(target.schema, formatResponse(result, hash, source, samples.length));

                for (let sample of relevantSamples) {
                    sample.response_id = responseId;
                    sample.operator_id = foreignFields.operator.existing[sample.operator?.id];
                    sample.load_factor_id = foreignFields.load_factor.existing[sample.load_factor];
                    sample.product_type_id = foreignFields.product_type.existing[sample.product_type];
                }
                if (relevantSamples.length > 0) {
                    await db.insertSamples(target.schema, relevantSamples);
                }
                await db.commit();

                ctrs.persisted += relevantSamples.length;
            } catch (err) {
                await db.rollback();
                if (err.constraint != 'hash' && err.table != 'response_log') {
                    console.log(relevantStations);
                    console.log(relevantSamples);
                    console.log(err);
                    break;
                } else {
                    console.log('Skipping response.');
                    ctrs.skipped += relevantSamples.length;
                }
            }
        }       

        console.log('counters:', ctrs);
        console.log('rtDiff minmaxavg', rtDiffMin, rtDiffMax, rtDiffSum/rtDiffCount);
    }
}


for (const target of conf.targets) { 
    await processSamples(target);
}

db.disconnect();