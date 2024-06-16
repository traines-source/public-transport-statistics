
import md5 from 'md5'
import fs from 'fs'
import { Transform } from 'stream';
import { pipeline } from 'node:stream/promises'

import db from './db.js'
import {conf} from './read-conf.js'

const fallbackRtDiff = 120;

const loadForeignFields = async (target) => {
    if (!target.disableAutoIds) {
        return {
            operator: { existing: await db.getOperatorMap(target.schema), missing: {} },
            load_factor: { existing: await db.getLoadFactorMap(target.schema), missing: {} },
            product_type: { existing: await db.getProductTypeMap(target.schema), missing: {} },
            prognosis_type: { existing: await db.getPrognosisTypeMap(target.schema), missing: {} }
        }
    } 
    return null;
}

const formatStation = (station) => {
    //station.station_id = parseInt(station.station_id);
    //if (station.parent) station.parent = parseInt(station.parent);
    station.lonlat = '('+station.lon+','+station.lat+')';
    return station;
}

const formatResponse = (result, source, sampleCount, rtTime, ctrs) => {
    const typeIds = {
        "journeys": 0,
        "departures": 1,
        "arrivals": 2,
        "trip": 3,
        "refreshJourney": 4,
        "gtfsrtTripUpdate": 10
    }
    return {
        hash: result.hash,
        type: typeIds[result.type],
        response_time: result.ts || (rtTime ? new Date(rtTime.getTime()+fallbackRtDiff*1000) : null),
        response_time_estimated: !result.ts,
        sample_time_estimated: !rtTime,
        source: source.sourceid,
        sample_count: sampleCount,
        ctrs: ctrs
    };
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

const formatSample = (sample) => {
    //sample.id
    sample.scheduled_time = new Date(sample.scheduled_time);
    if (sample.projected_time) sample.projected_time = new Date(sample.projected_time);
    if (sample.delay_seconds != null) sample.delay_minutes = Math.round(sample.delay_seconds/60);
    sample.cancelled = !!sample.cancelled;
    if (sample.sample_time) sample.sample_time = new Date(sample.sample_time*1000);
    if (sample.sample_time) sample.ttl_minutes = Math.round(((sample.projected_time || sample.scheduled_time).getTime()-sample.sample_time.getTime())/1000/60);
    //scheduled_duration
    //projected_duration
    //sample.trip_id
    //sample.line_name
    //sample.line_fahrtnr = parseInt(sample.line_fahrtnr) || null;
    //sample.product_type_id
    //sample.product_name
    //sample.station_id = parseInt(sample.station_id);
    //sample.operator_id
    //sample.is_departure   
    //sample.remarks
    //sample.stop_number    
    //if (sample.destination_provenance_id) sample.destination_provenance_id = parseInt(sample.destination_provenance_id);
    //sample.scheduled_platform
    //sample.projected_platform
    //sample.load_factor
    //sample.response_id
    return true;
}

const enrichSample = (sample, ctrs, target, sampleHashes, relevantRemarks, relevantStations, foreignFields) => {
    const sampleHash = md5(JSON.stringify(sample));
    if (sampleHashes[sampleHash]) {
        ctrs.sampleDuplicates++;
        return false;
    }
    sampleHashes[sampleHash] = true;
    
    if (sample.remarks?.length) {
        ctrs.remarks++;
        const remarks = JSON.stringify(sample.remarks)
        const remarks_hash = md5(remarks);
        relevantRemarks[remarks_hash] = {remarks_hash: remarks_hash, remarks: remarks};
        sample.remarks_hash = remarks_hash;
    }
    updateRelevantStations(sample, relevantStations);
    if (!target.disableAutoIds) {
        setIfMissing(foreignFields.operator, sample.operator?.id, sample.operator);
        setIfMissing(foreignFields.load_factor, sample.load_factor, sample.load_factor);
        setIfMissing(foreignFields.product_type, sample.product_type, sample.product_type);
        setIfMissing(foreignFields.prognosis_type, sample.prognosis_type, sample.prognosis_type);
    }
    return true;
}

const updateRelevantStations = (sample, relevantStations) => {
    for (let station of sample.stations) {
        if (!relevantStations[station.station_id]) {
            relevantStations[station.station_id] = formatStation(station);
        }
    }
}

const analyzeSample = (sample, ctrs, fallbackSampleTime) => {
    ctrs.samples++;
    if (sample.delay_minutes != null) {
        ctrs.rtSamples++;
    }
    if (!sample.sample_time) {
        sample.sample_time = fallbackSampleTime;
        ctrs.fallbackSampleTime++;
    }
    if (!sample.sample_time) {
        ctrs.missingSampleTime++;
        return false;
    }
    if (Math.abs(sample.ttl_minutes) > 24*60) {
        ctrs.outside24h++;
        if (sample.delay_minutes != null) ctrs.outside24hWithRt++;
        if (Math.abs(sample.ttl_minutes) > 6*30*24*60) {
            ctrs.outside6Months++;
        }
        return false;
    }
    if (sample.delay_minutes > 12*60) {
        ctrs.delayGreater12h++;
    } else if (sample.delay_minutes < -50) {
        ctrs.delayLargeNegative++;
    }
    
    if (sample.cancelled) ctrs.cancelled++;
    ctrs.relevantSamples++;
    return true;
}

const getFallbackSampleTime = (result) => {
    if (!result.ts) return null;
    return new Date(result.ts.getTime()-fallbackRtDiff*1000);
}

const blockCommit = async (result, relevantSamples, ctrs, target, source, relevantRemarks, relevantStations, foreignFields, lastSampleTime) => {
    try {
        await db.begin();
        await insertMissing(foreignFields.operator, db.insertOperators, target.schema);
        await insertMissing(foreignFields.load_factor, db.insertLoadFactors, target.schema);
        await insertMissing(foreignFields.product_type, db.insertProductTypes, target.schema);
        await insertMissing(foreignFields.prognosis_type, db.insertPrognosisTypes, target.schema);
        
        const relevantStationList = Object.values(relevantStations);
        if (relevantStationList.length > 0) {
            await db.upsertStations(target.schema, relevantStationList);
        }
        const relevantRemarksList = Object.values(relevantRemarks);
        if (relevantRemarksList.length > 0) {
            await db.upsertRemarks(target.schema, relevantRemarksList);
        }
        if (relevantSamples.length > 0) {
            const responseId = await db.insertResponse(target.schema, formatResponse(result, source, ctrs.samples, lastSampleTime, ctrs));
            if (!target.disableAutoIds) {
                for (let sample of relevantSamples) {
                    sample.response_id = responseId;
                    sample.operator_id = foreignFields.operator.existing[sample.operator?.id];
                    sample.load_factor_id = foreignFields.load_factor.existing[sample.load_factor];
                    sample.product_type_id = foreignFields.product_type.existing[sample.product_type];
                    sample.prognosis_type_id = foreignFields.prognosis_type.existing[sample.prognosis_type];
                }
            }
            await db.insertSamples(target.schema, relevantSamples);
        }
        await db.commit();
        ctrs.persistedSamples += relevantSamples.length;
    } catch (err) {
        await db.rollback();
        if (err.table != 'response_log' || err.constraint != 'hash') {
            console.log('error', err);
            console.log(result, lastSampleTime);
            fs.writeFileSync(conf.working_dir+'err_dump.json', JSON.stringify([result.response, relevantStations, relevantSamples, err], null, 2));
            return true;
        } else {
            console.log('Skipping response already stored.');
            ctrs.skippedSamples += relevantSamples.length;
        }
    }
    return false;
}


const updateResponseCtrs = (ctrs, result, lastSampleTime) => {
    const actualCount = ctrs.rtSamples;
    const expectedRtCount = isNaN(result.expectedRtCount) ? result.expectedRtCount() : result.expectedRtCount;
    if (expectedRtCount != actualCount) {
        ctrs.incorrectRtCount++;
        const d = result.expectedRtCount - actualCount;
        if (d > 0) ctrs.missingRts += d;
        if (d < 0) ctrs.excessRts -= d
    }
    if (ctrs.samples == 0) {
        ctrs.emptyResponses++;
    }
    if (lastSampleTime && result.ts) {
        ctrs.rtDiffCount++;
        const diff = (result.ts.getTime()-lastSampleTime.getTime())/1000;
        ctrs.rtDiffSum += diff;
    }
}

const loopSamples = async (samples, ctrs, result, target, source, sampleHashes, foreignFields) => {
    let relevantStations = {};
    let relevantRemarks = {};
    let relevantSamples = [];
    let firstSampleTime = undefined;
    let lastSampleTime = undefined;
    let fallbackSampleTime = getFallbackSampleTime(result);
    for (let sample of samples) {
        if (!sample.station_id) {
            updateRelevantStations(sample, relevantStations);
            continue;
        }
        if (formatSample(sample)
            && analyzeSample(sample, ctrs, fallbackSampleTime)
            && enrichSample(sample, ctrs, target, sampleHashes, relevantRemarks, relevantStations, foreignFields)
            ) {
            relevantSamples.push(sample);
            if (!firstSampleTime) firstSampleTime = sample.sample_time;
            lastSampleTime = sample.sample_time;
        }
    }
    updateResponseCtrs(ctrs, result, lastSampleTime);
    const errorOccurred = await blockCommit(result, relevantSamples, ctrs, target, source, relevantRemarks, relevantStations, foreignFields, lastSampleTime);
    return {firstSampleTime: firstSampleTime, lastSampleTime: lastSampleTime, errorOccurred: errorOccurred};
}

const streamSamples = async (samplesStream, ctrs, result, target, source) => {
    let errorOccurred = false;
    let firstSampleTime = undefined;
    let lastSampleTime = undefined;
    const fallbackSampleTime = getFallbackSampleTime(result);

    const perf_start = performance.now();

    try {
        await db.begin();
        const transformer = new Transform({
            transform(sample, encoding, callback) {
                if (!firstSampleTime) firstSampleTime = sample.sample_time;
                lastSampleTime = sample.sample_time;
                callback(null, analyzeSample(sample, ctrs, fallbackSampleTime) ? db.sampleToTSV(sample) : '');
            },
            writableObjectMode: true
        });
        console.log('start streaming');
        await pipeline(samplesStream, transformer, db.streamInsertSamples(target.schema));
        console.log('done streaming');
        updateResponseCtrs(ctrs, result, lastSampleTime);
        await db.insertResponse(target.schema, formatResponse(result, source, ctrs.samples, lastSampleTime, ctrs));
        await db.commit();
        ctrs.persistedSamples += ctrs.relevantSamples;
    } catch (err) {
        await db.rollback();
        console.log('error', err);
        errorOccurred = true;
    }

    console.log('end commit', performance.now()-perf_start);
    return {firstSampleTime: firstSampleTime, lastSampleTime: lastSampleTime, errorOccurred: errorOccurred};
}



export default {
    loadForeignFields,
    loopSamples,
    streamSamples
}