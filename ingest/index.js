
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

const formatResponse = (result, hash, source, sampleCount, rtTime) => {
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
        rt_time: rtTime,
        source: source.sourceid,
        sample_count: sampleCount
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
    //sample.trip_id
    //sample.line_name
    sample.line_fahrtnr = parseInt(sample.line_fahrtnr);
    //sample.product_type_id
    //sample.product_name
    sample.station_id = parseInt(sample.station_id);
    //sample.operator_id
    //sample.is_departure   
    //sample.remarks
    //sample.stop_number    
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
    const responseHashes = {};
    const sampleHashes = {};
    let errorOccurred = false;
    const foreignFields = {
        operator: { existing: await db.getOperatorMap(target.schema), missing: {} },
        load_factor: { existing: await db.getLoadFactorMap(target.schema), missing: {} },
        product_type: { existing: await db.getProductTypeMap(target.schema), missing: {} }
    }
    for (const source of target.sources) {
        if (source.disabled) continue;

        const it = responseReader(source, target.schema, true);

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
            missingRts: 0,
            excessRts: 0,
            persisted: 0,
            outside24h: 0,
            outside24hWithRt: 0,
            outside6Months: 0,
            missingSampleTime: 0,
            fallbackSampleTime: 0,
            skipped: 0,
            sampleDuplicates: 0,
            remarks: 0,
            cancelled: 0,
        }

        while ((result = await it.next())) {
            if (!validateResult(result, ctrs)) {
                continue;
            }
            const str = JSON.stringify(result.response);
            const hash = md5(str);
            if (responseHashes[hash]) {
                ctrs.duplicates++;
                continue;
            }
            responseHashes[hash] = true;
            ctrs.validResponses++;

            const samples = transformSamples[result.type](result.response);
            const actualCount = samples.filter(e => e.delay_seconds != null).length;

            ctrs.samples += samples.length;
            ctrs.rtSamples += actualCount;
           
            if (result.expectedRtCount != actualCount) {
                ctrs.incorrectRtCount++;
                const d = result.expectedRtCount - actualCount;
                if (d > 0) ctrs.missingRts += d;
                if (d < 0) ctrs.excessRts -= d
                //console.log('incorrectRtCount:', result.expectedRtCount, actualCount, samples.length, result.type);//, JSON.stringify(result.response), extracted);
            }
            //console.log(extracted);
            //break;

            const rtTime = result.response?.realtimeDataFrom || result.response?.realtimeDataUpdatedAt;
            if (rtTime) {
                rtDiffCount++;
                const diff = result.ts?.getTime()/1000-(rtTime);
                if (diff < rtDiffMin) rtDiffMin = diff;
                if (diff > rtDiffMax) rtDiffMax = diff;
                rtDiffSum += diff;
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
                
                sample = formatSample(sample);
                if (Math.abs(sample.ttl_minutes) > 24*60) {
                    ctrs.outside24h++;
                    if (result.delay_minutes != null) ctrs.outside24hWithRt++;
                    if (Math.abs(sample.ttl_minutes) > 6*30*24*60) ctrs.outside6Months++;
                    continue;
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
                const relevantRemarksList = Object.values(relevantRemarks);
                if (relevantRemarksList.length > 0) {
                    await db.upsertRemarks(target.schema, relevantRemarksList);
                }

                const responseId = await db.insertResponse(target.schema, formatResponse(result, hash, source, samples.length, rtTime ? new Date(rtTime*1000) : null));

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
                if (err.table != 'response_log' || err.constraint != 'hash') {
                    console.log(err);
                    fs.writeFileSync(conf.working_dir+'err_dump.json', JSON.stringify([result.response, relevantStations, relevantSamples, err], null, 2));
                    errorOccurred = true;
                    break;
                } else {
                    console.log('Skipping response.');
                    ctrs.skipped += relevantSamples.length;
                }
            }
        }       

        console.log('counters:', ctrs);
        console.log('rtDiff minmaxavg', rtDiffMin, rtDiffMax, rtDiffSum/rtDiffCount);
        if (errorOccurred) {
            console.log('TERMINATING due to error.');
            break;
        }
    }
}


for (const target of conf.targets) { 
    await processSamples(target);
}

db.disconnect();