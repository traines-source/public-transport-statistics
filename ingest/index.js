
import md5 from 'md5'
import fs from 'fs'

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
    if (result.type == 'radar' || result.type == 'location') {
        ctrs.typeRadarOrLocation++;
        return false;
    }
    if (!result.response) {
        ctrs.emptyResponses++;
        return false;
    }
    return true;
}

const formatStation = (station) => {
    //station.station_id = parseInt(station.station_id);
    //if (station.parent) station.parent = parseInt(station.parent);
    station.lonlat = '('+station.lon+','+station.lat+')';
    return station;
}

const formatResponse = (result, hash, source, sampleCount, rtTime, ctrs, lastResponseCtrs) => {
    const typeIds = {
        "journeys": 0,
        "departures": 1,
        "arrivals": 2,
        "trip": 3,
        "refreshJourney": 4,
        "gtfsrtTripUpdate": 10
    }
    const diffCtrs = {};
    for (const [key, value] of Object.entries(ctrs)) {
        diffCtrs[key] = value-lastResponseCtrs[key];
    }
    return {
        hash: hash,
        type: typeIds[result.type],
        response_time: result.ts || (rtTime ? new Date((rtTime+fallbackRtDiff)*1000): null),
        response_time_estimated: !result.ts,
        sample_time_estimated: !rtTime,
        source: source.sourceid,
        sample_count: sampleCount,
        ctrs: diffCtrs
    };
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
    let responseHashes = {};
    let sampleHashes = {};
    let errorOccurred = false;
    let firstSampleTime = undefined;
    const foreignFields = {
        operator: { existing: await db.getOperatorMap(target.schema), missing: {} },
        load_factor: { existing: await db.getLoadFactorMap(target.schema), missing: {} },
        product_type: { existing: await db.getProductTypeMap(target.schema), missing: {} },
        prognosis_type: { existing: await db.getPrognosisTypeMap(target.schema), missing: {} }
    }
    for (const source of target.sources) {
        if (source.disabled) continue;

        const identifier = target.schema+'-'+source.sourceid;
        const it = await responseReader(source, identifier, true);

        let result;
        let rtDiffMin = 1000;
        let rtDiffMax = 0;
        const ctrs = {
            errors: 0,
            unknownTypes: 0,
            typeRadarOrLocation: 0,
            emptyResponses: 0,
            duplicateResponses: 0,
            validResponses: 0,
            samples: 0,
            rtSamples: 0,
            incorrectRtCount: 0,
            missingRts: 0,
            excessRts: 0,
            relevantSamples: 0,
            persistedSamples: 0,
            outside24h: 0,
            outside24hWithRt: 0,
            outside6Months: 0,
            delayGreater12h: 0,
            delayLargeNegative: 0,
            missingSampleTime: 0,
            fallbackSampleTime: 0,
            skippedSamples: 0,
            sampleDuplicates: 0,
            remarks: 0,
            cancelled: 0,
            perf_read: 0,
            perf_stringify: 0,
            perf_parse: 0,
            perf_persist: 0,
            perf_ctr: 0,
            rtDiffSum: 0,
            rtDiffCount: 0
        }
        let perf_start = performance.now();
        let continueWithNextFile = true;
        while ((result = await it.next(continueWithNextFile))) {
            const lastResponseCtrs = JSON.parse(JSON.stringify(ctrs));
            ctrs.perf_read += performance.now()-perf_start;
            ctrs.perf_ctr++;
            
            if (!validateResult(result, ctrs)) {
                if (result.err == 'gtfsUnavailable') {
                    errorOccurred = true;
                    break;
                }
                continue;
            }
            console.log('validated');
            
            perf_start = performance.now();
            const str = JSON.stringify(result.response);
            ctrs.perf_stringify += performance.now()-perf_start;
            const hash = md5(str);
            perf_start = performance.now();

            if (responseHashes[hash]) {
                ctrs.duplicateResponses++;
                continue;
            }
            responseHashes[hash] = true;
            ctrs.validResponses++;

            const samples = transformSamples[result.type](result.response);
            const actualCount = samples.filter(e => e.delay_seconds != null).length;

            ctrs.samples += samples.length;
            ctrs.rtSamples += actualCount;
            console.log('samples', samples.length);
           
            if (result.expectedRtCount != actualCount) {
                ctrs.incorrectRtCount++;
                const d = result.expectedRtCount - actualCount;
                if (d > 0) ctrs.missingRts += d;
                if (d < 0) ctrs.excessRts -= d
                //console.log('incorrectRtCount:', result.expectedRtCount, actualCount, samples.length, result.type);//, JSON.stringify(result.response), extracted);
            }
            if (samples.length == 0) {
                ctrs.emptyResponses++;
            }
            //console.log(extracted);
            //break;

            const rtTime = samples.length > 0 ? samples[samples.length-1].sample_time : null;
            if (rtTime) {
                ctrs.rtDiffCount++;
                const diff = result.ts?.getTime()/1000-rtTime;
                if (diff < rtDiffMin) rtDiffMin = diff;
                if (diff > rtDiffMax) rtDiffMax = diff;
                ctrs.rtDiffSum += diff;
            }

            let relevantStations = {};
            let relevantRemarks = {};
            let relevantSamples = [];
            for (let sample of samples) {
                if (!sample.sample_time) {
                    sample.sample_time = result.ts?.getTime()/1000-fallbackRtDiff;
                    ctrs.fallbackSampleTime++;
                }
                if (!sample.sample_time) {
                    ctrs.missingSampleTime++;
                    continue;
                }
                const sampleHash = md5(JSON.stringify(sample));
                if (sampleHashes[sampleHash]) {
                    ctrs.sampleDuplicates++;
                    continue;
                }
                sampleHashes[sampleHash] = true;
                
                if (!firstSampleTime) firstSampleTime = sample.sample_time;
                else if (sample.sample_time-firstSampleTime > 24*60*60) continueWithNextFile = false;
                
                sample = formatSample(sample);
                if (Math.abs(sample.ttl_minutes) > 24*60) {
                    ctrs.outside24h++;
                    if (sample.delay_minutes != null) ctrs.outside24hWithRt++;
                    if (Math.abs(sample.ttl_minutes) > 6*30*24*60) {
                        ctrs.outside6Months++;
                    }
                    continue;
                }
                if (sample.delay_minutes > 12*60) {
                    ctrs.delayGreater12h++;
                } else if (sample.delay_minutes < -30) {
                    ctrs.delayLargeNegative++;
                }
                
                if (sample.cancelled) ctrs.cancelled++;
                if (sample.remarks?.length) {
                    ctrs.remarks++;
                    const remarks = JSON.stringify(sample.remarks)
                    const remarks_hash = md5(remarks);
                    relevantRemarks[remarks_hash] = {remarks_hash: remarks_hash, remarks: remarks};
                    sample.remarks_hash = remarks_hash;
                } 

                for (let station of sample.stations) {
                    relevantStations[station.station_id] = formatStation(station);
                }
                              
                relevantSamples.push(sample);                

                setIfMissing(foreignFields.operator, sample.operator?.id, sample.operator);
                setIfMissing(foreignFields.load_factor, sample.load_factor, sample.load_factor);
                setIfMissing(foreignFields.product_type, sample.product_type, sample.product_type);
                setIfMissing(foreignFields.prognosis_type, sample.prognosis_type, sample.prognosis_type);
            }

            ctrs.perf_parse += performance.now()-perf_start;
            perf_start = performance.now();
            
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
                ctrs.relevantSamples += relevantSamples.length;
                if (relevantSamples.length > 0) {
                    const responseId = await db.insertResponse(target.schema, formatResponse(result, hash, source, samples.length, rtTime, ctrs, lastResponseCtrs));
                    for (let sample of relevantSamples) {
                        sample.response_id = responseId;
                        sample.operator_id = foreignFields.operator.existing[sample.operator?.id];
                        sample.load_factor_id = foreignFields.load_factor.existing[sample.load_factor];
                        sample.product_type_id = foreignFields.product_type.existing[sample.product_type];
                        sample.prognosis_type_id = foreignFields.prognosis_type.existing[sample.prognosis_type];
                    }
                    await db.insertSamples(target.schema, relevantSamples);
                }
                await db.commit();
                ctrs.persistedSamples += relevantSamples.length;            
            } catch (err) {
                await db.rollback();
                if (err.table != 'response_log' || err.constraint != 'hash') {
                    console.log(err);
                    fs.writeFileSync(conf.working_dir+'err_dump.json', JSON.stringify([result.response, relevantStations, relevantSamples, err], null, 2));
                    errorOccurred = true;
                    break;
                } else {
                    console.log('Skipping response already stored.');
                    ctrs.skippedSamples += relevantSamples.length;
                }
            }
                
            ctrs.perf_persist += performance.now()-perf_start;
            perf_start = performance.now();
            if (ctrs.validResponses % 1000 == 0) {
                console.log('counters:', ctrs, new Date());
                console.log('perf', ctrs.perf_read/ctrs.perf_ctr, ctrs.perf_parse/ctrs.perf_ctr, ctrs.perf_persist/ctrs.perf_ctr);
                ctrs.perf_read = 0;
                ctrs.perf_parse = 0;
                ctrs.perf_persist = 0;
                ctrs.perf_ctr = 0;
                responseHashes = {};
                sampleHashes = {};
            }
        }

        console.log('counters:', ctrs, new Date());
        console.log('rtDiff minmaxavg', rtDiffMin, rtDiffMax, ctrs.rtDiffSum/ctrs.rtDiffCount);
        if (errorOccurred) {
            console.log('TERMINATING due to error.');
            break;
        }
    }
    if (!errorOccurred) {
        //await db.updateMaterializedHistograms(target.schema);
    }
    return !errorOccurred && firstSampleTime;
}

console.log("===========");
console.log("Starting...");
console.log("===========");
let shallContinue = true;
while (shallContinue) {
    for (const target of conf.targets) {
        if (target.disabled) continue;
        shallContinue = await processSamples(target) && shallContinue;
    }
}

db.disconnect();