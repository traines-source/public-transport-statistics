import csv from 'csv-parser';
import stripBomStream from 'strip-bom-stream';
import md5 from 'md5'
import fs from 'fs';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import { Readable } from 'stream';

import {findAndOpenNextFile, getFilesIterator, responseReader} from './read-response.js';
import db from './db.js'
import {conf} from './read-conf.js';

const randomOfflineSamplesNumber = 1;

const getValidUntil = (gtfsFilesIterator, current) => {
    const next = gtfsFilesIterator.next(current);
    console.log(next);
    if (next) {
        const mtime = new Date(fs.statSync(next).mtimeMs);
        console.log(mtime);
        return new Date(mtime.getFullYear(), mtime.getMonth(), mtime.getDate(), 14, 0, 0, 0).getTime()/1000;
    }
    return null;
}

const gtfsCache = {};


const parseCsv = async (file, setRow) => {
    return new Promise((done) => {
        fs.createReadStream(file)
        .pipe(stripBomStream())
        .pipe(csv())
        .on('data', setRow)
        .on('end', () => {
            console.log('done reading', file);
            done(true);
        });
    });
}

const filterFields = (row, columns) => {
    const filtered = {};
    for (const col of columns) {
        filtered[col] = row[col];
    }
    return filtered;
}

const parseGtfsCsv = async (cache, directory, type, key, columns) => {
    const results = {};
    await parseCsv(directory+type+'.txt', (row) => results[row[key]] = filterFields(row, [key, ...columns]));
    cache[type] = results;
}

const loadGtfs = async (cache, directory) => {
    await parseGtfsCsv(cache, directory, 'agency', 'agency_id', ['agency_name']);
    await parseGtfsCsv(cache, directory, 'stops', 'stop_id', ['stop_name', 'stop_lat', 'stop_lon', 'parent_station', 'platform_code']);
    await parseGtfsCsv(cache, directory, 'routes', 'route_id', ['agency_id', 'route_short_name', 'route_type', 'route_desc']);
    await parseGtfsCsv(cache, directory, 'trips', 'trip_id', ['route_id', 'trip_short_name']);
    console.log(Object.keys(cache['trips']).length, cache['trips'][Object.keys(cache['trips'])[0]]);
    await parseCsv(directory+'stop_times.txt', (row) => {
        //console.log(row['trip_id'], row);
        const trip = cache['trips'][row['trip_id']];
        if (!trip['stop_times']) trip['stop_times'] = [];
        trip['stop_times'].push({
            'arrival_time': row['arrival_time'] ? splitTimeStr(row['arrival_time']) : null,
            'departure_time': row['departure_time'] ? splitTimeStr(row['departure_time']) : null,
            'stop_id': row['stop_id'],
            'stop_sequence': parseInt(row['stop_sequence'])
        });
    });
}

const getStations = (gtfs) => {
    const out = [];
    const keys = Object.keys(gtfs.stops);
    for (let key of keys) {
        const s = gtfs.stops[key];
        out.push({
            station_id: s.stop_id,
            name: s.stop_name,
            lonlat: '('+s.stop_lon+','+s.stop_lat+')',
            parent: s.parent_station ? s.parent_station : null
        });    
    }
    return out;
}


const getOperators = (gtfs) => {
    const out = [];
    const keys = Object.keys(gtfs.agency);
    for (let key of keys) {
        const s = gtfs.agency[key];
        s.operator_id = parseInt(s.agency_id) || 0;
        if (s.operator_id > 30000) s.operator_id = 0;
        if (s.operator_id == 0) continue;
        out.push({
            operator_id: s.operator_id,
            id: s.agency_id,
            name: s.agency_name
        });
    }
    out.push({
        operator_id: 0,
        id: '0',
        name: 'Other'
    });
    return out;
}

const persistGtfsToDb = async (gtfs, schema) => {
    console.log('persisting gtfs stops and agencies');
    await db.begin();
    await db.upsertStations(schema, getStations(gtfs));
    await db.upsertOperators(schema, getOperators(gtfs));
    await db.commit();
    console.log('done persisting gtfs stops and agencies');
}

const prepareRelevantGtfs = async (timestamp, identifier, gtfsFilesIterator, gtfsSource, gtfsrtFile, schema) => {
    let previousGtfs = undefined;
    while (timestamp > gtfsCache[identifier]['validUntil']) {
        previousGtfs = gtfsCache[identifier]['file'];
        gtfsCache[identifier]['file'] = gtfsFilesIterator.next(gtfsCache[identifier]['file']);
        gtfsCache[identifier]['validUntil'] = getValidUntil(gtfsFilesIterator, gtfsCache[identifier]['file']);
        console.log(gtfsCache[identifier]['file'], gtfsCache[identifier]['validUntil'])
        if (!gtfsCache[identifier]['file'] || !gtfsCache[identifier]['validUntil']) {
            console.log('stopping. missing up to date GTFS');
            return false;
        }
    }
    if (previousGtfs != undefined) {
        /*const fastLoadFile = conf.working_dir+identifier+'_gtfscache.json';
        if (fs.existsSync(fastLoadFile)) {
            console.log('Using GTFS fastLoadFile');
            gtfsCache[identifier] = JSON.parse(fs.readFileSync(fastLoadFile));
            return true;
        }*/
        console.log('Switching to GTFS', gtfsCache[identifier]['file'], 'for GTFSRT', gtfsrtFile);
        const open = await findAndOpenNextFile(gtfsSource, identifier, gtfsFilesIterator, previousGtfs);
        if (open.file != gtfsCache[identifier]['file'])
            throw Error('file mismatch');
        await loadGtfs(gtfsCache[identifier]['data'], open.fileReader);
        await persistGtfsToDb(gtfsCache[identifier]['data'], schema);
        //fs.writeFileSync(fastLoadFile, JSON.stringify(gtfsCache[identifier]), 'utf8');
    }
    return true;
}

const productType = (id) => {
    // TODO not only switzerland
    if (id >= 700 && id < 800) return 700; //'bus';
    if (id >= 200 && id < 300) return 200; //'coach';
    if (id >= 400 && id < 500) return 400; //'metro';
    if (id >= 900 && id < 1000) return 900; //'tram';
    if (id >= 101 && id < 103) return 102; //'nationalExpress';
    if (id >= 105 && id < 106) return 102; //'nationalExpress';
    if (id >= 100 && id < 104) return 100; //'regionalExpress';
    if (id >= 104 && id < 109) return 104; //'regional';
    if (id >= 109 && id < 110) return 109; //'suburban';
    return 1000; //'special';
}

const splitTimeStr = (s) => {
    const parts = s.split(':');
    return {
        h: parseInt(parts[0]),
        m: parseInt(parts[1]),
        s: parseInt(parts[2])
    };
}

const calculateStartTime = (trip, tripUpdate) => {
    const scheduled = trip.stop_times[0].departure_time;
    const startDate = tripUpdate.trip.startDate;
    const startTime = tripUpdate.trip.startTime ? splitTimeStr(tripUpdate.trip.startTime) : scheduled;
    const noonMinus12 = new Date(
        parseInt(startDate.substring(0,4)),
        parseInt(startDate.substring(4,6))-1,
        parseInt(startDate.substring(6,8)),
        12+startTime.h-scheduled.h
    ).getTime()/1000-12*60*60;
    return noonMinus12;
}

const joinTime = (startTime, scheduledTime, realTime, previousTime)  => {
    let scheduledDatetime;
    let realDatetime = null;
    let delaySeconds = null;

    if (!startTime) throw Error('Date fallback not implemented');
    scheduledDatetime = (startTime+(scheduledTime.h*60+scheduledTime.m)*60+scheduledTime.s)*1000;

    if (realTime && realTime.delay != undefined) {
        delaySeconds = realTime.delay;
        realDatetime = scheduledDatetime+delaySeconds*1000;
    } else if (realTime && realTime.time) {
        delaySeconds = realTime.time.toNumber()-scheduledDatetime/1000;
        realDatetime = realTime.time.toNumber()*1000;
    } else if (previousTime && previousTime.delay != null) {
        delaySeconds = previousTime.delay;
        realDatetime = scheduledDatetime+delaySeconds*1000;
    }
    
    return {scheduled: scheduledDatetime, real: realDatetime, delay: delaySeconds}
}

const populateSample = (meta, is_departure, cancelled, stopTime, time, sampleTime, previousTime, previousSample) => {
    const s = {
        sample_time: meta.sample_time,
        trip_id: meta.trip_id,
        line_name: meta.line_name,
        line_fahrtnr: meta.line_fahrtnr,
        product_type_id: meta.product_type_id,
        product_name: meta.product_name,
        operator_id: meta.operator_id,
        cancelled: cancelled,
        station_id: stopTime.stop_id,
        stop_number: stopTime.stop_sequence,
        scheduled_time: new Date(time.scheduled),
        //projected_time: meta.cancelled ? null : time.real,
        delay_minutes: meta.cancelled || time.delay == null ? null : Math.round(time.delay/60),
        ttl_minutes: Math.round(((time.real || time.scheduled)/1000-sampleTime)/60),
        is_departure: is_departure
        //destination_provenance_id: destination_provenance_id
    };
    if (previousTime) {
        previousSample.scheduled_duration_minutes = Math.round((time.scheduled-previousTime.scheduled)/1000/60);
        if (time.real && previousTime.real) {
            previousSample.projected_duration_minutes = Math.round((time.real-previousTime.real)/1000/60);
        }
    }
    return s;
}

const matchesStopTime = (stopTime, stopTimeUpdate) => {
    return stopTimeUpdate.stopId == stopTime.stop_id || stopTimeUpdate.stopSequence == parseInt(stopTime.stop_sequence)
}

const isCancelled = (tripCancelled, stopTimeUpdate, previousCancelled) => {
    if (tripCancelled) {
        return tripCancelled;
    }
    if (stopTimeUpdate) {
        return stopTimeUpdate.scheduleRelationship == GtfsRealtimeBindings.transit_realtime.TripUpdate.StopTimeUpdate.ScheduleRelationship.SKIPPED;
    }
    return previousCancelled;
}

const handleTrip = (gtfs, trip, tripUpdate, sampleTime, samples) => {
    const route = gtfs.routes[trip.route_id];
    const operator_id = gtfs.agency[route.agency_id].operator_id;
    const product_type_id = productType(parseInt(route.route_type));
    const tripCancelled = tripUpdate.trip.scheduleRelationship == GtfsRealtimeBindings.transit_realtime.TripDescriptor.ScheduleRelationship.CANCELED;
    const startTime = calculateStartTime(trip, tripUpdate);
    let jUpdate = 0;
    let expectedRtCount = 0;
    let previousTime = null;
    let previousSample = null;
    let previousCancelled = false;

    const len = trip.stop_times.length;
    const meta = {
        sample_time: new Date(sampleTime*1000),
        trip_id: trip.trip_id,
        line_name: route.route_short_name,
        line_fahrtnr: trip.trip_short_name,
        product_type_id: product_type_id,
        product_name: route.route_type,
        operator_id: operator_id,
        //remarks, 
        //scheduled_platform
        //projected_platform
        //load_factor
        //response_id
    }
    for (let j=0; j<len; j++) {
        const stopTime = trip.stop_times[j];
        let stopTimeUpdate = null;
        if (tripUpdate.stopTimeUpdate?.length > jUpdate+1 && matchesStopTime(stopTime, tripUpdate.stopTimeUpdate[jUpdate+1])) {
            jUpdate++;
            stopTimeUpdate = tripUpdate.stopTimeUpdate[jUpdate];
        } else if (jUpdate == 0 && tripUpdate.stopTimeUpdate && matchesStopTime(stopTime, tripUpdate.stopTimeUpdate[jUpdate])) {
            stopTimeUpdate = tripUpdate.stopTimeUpdate[jUpdate];
        }

        previousCancelled = isCancelled(tripCancelled, stopTimeUpdate, previousCancelled);
        if ((stopTimeUpdate?.arrival || stopTime.arrival_time) && j != 0) {
            let time = joinTime(startTime, stopTime.arrival_time, stopTimeUpdate?.arrival, previousTime);
            previousSample = populateSample(meta, false, previousCancelled, stopTime, time, sampleTime, previousTime, previousSample);
            samples.push(previousSample);
            previousTime = time;
            if (time.delay != null && !meta.cancelled) expectedRtCount++;
        }
        if ((stopTimeUpdate?.departure || stopTime.departure_time) && j != len-1) {
            let time = joinTime(startTime, stopTime.departure_time, stopTimeUpdate?.departure, previousTime);
            previousSample = populateSample(meta, true, previousCancelled, stopTime, time, sampleTime, previousTime, previousSample);
            samples.push(previousSample);
            previousTime = time;
            if (time.delay != null && !meta.cancelled) expectedRtCount++;
        }
    }
    return expectedRtCount;
}

const createRandomOfflineSamples = (gtfs, trip, tripUpdate, sampleTime, samples) => {
    if (!trip.receivedRealtime || !trip.receivedRealtime[tripUpdate.trip.startDate]) {
        for (let k=0; k<randomOfflineSamplesNumber; k++) {
            const randomSampleTime = Math.round(sampleTime-Math.random()*10*60*60);
            handleTrip(gtfs, trip, {trip: tripUpdate.trip}, randomSampleTime, samples);
        }
        if (!trip.receivedRealtime) trip.receivedRealtime = {};
        trip.receivedRealtime[tripUpdate.trip.startDate] = true;
    }
}

const prepareNextSamples = (tripUpdate, gtfs, sampleTime, samples) => {
    
    if (!tripUpdate) {
        return 0;
    }
    const trip = gtfs.trips[tripUpdate.trip.tripId];
    if (!trip || !trip.stop_times?.length) {
        return 0;
    }
    if (tripUpdate.trip.scheduleRelationship != GtfsRealtimeBindings.transit_realtime.TripDescriptor.ScheduleRelationship.SCHEDULED
        && tripUpdate.trip.scheduleRelationship != GtfsRealtimeBindings.transit_realtime.TripDescriptor.ScheduleRelationship.CANCELED) {
        return 0;
    }
    createRandomOfflineSamples(gtfs, trip, tripUpdate, sampleTime, samples);
    return handleTrip(gtfs, trip, tripUpdate, sampleTime, samples);
}

const assembleResponse = (data, gtfs, sampleTime, fallbackSampleTime) => {
    let len = data.entity.length;
    let i = 0;
    let expectedRtCount = 0;
    const stream = new Readable({ 
        read() {
            let samplesRead = 0;
            while (i < len && !samplesRead) {
                samplesRead += prepareNextSamples(data.entity[i].tripUpdate, gtfs, sampleTime, this);
                i++;
            }
            expectedRtCount += samplesRead;
            if (i >= len) this.push(null);
        },
        objectMode: true
    });
    return {response: stream, hash: md5(fallbackSampleTime), ts: fallbackSampleTime, type: 'gtfsrtTripUpdate', expectedRtCount: () => expectedRtCount, err: null};
}

const extractGtfsrt = async (dir, identifier, source) => {
    const gtfsSource = {
        "sourceid": 0,
        "matches": source.gtfsmatches,
        "compression": "unzip",
        "type": "noop"
    }
    const gtfsrtExplodedSource = {
        "sourceid": 0,
        "matches": dir+'*/*.gtfsrt',
        "compression": "none",
        "type": "callonce",
        "restartWhenLastSuccessfullNotMatching": true
    }
    identifier += '-gtfs';
    const gtfsrtFiles = await responseReader(gtfsrtExplodedSource, identifier+'rt-exploded', true);
    const gtfsFilesIterator = await getFilesIterator(gtfsSource);
    
    if (!gtfsCache[identifier]) {
        gtfsCache[identifier] = {};
        gtfsCache[identifier]['file'] = null;
        gtfsCache[identifier]['validUntil'] = 0;
        gtfsCache[identifier]['data'] = {};
    }
   
    let gtfsrtFile;
    return {
        next: async () => {
            if (gtfsrtFile = await gtfsrtFiles.next(true)) {
                console.log('reading', gtfsrtFile);
                const buffer = fs.readFileSync(gtfsrtFile);
                const fallBackSampleTime = new Date(fs.statSync(gtfsrtFile).mtimeMs);
                const data = GtfsRealtimeBindings.transit_realtime.FeedMessage.toObject(GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(buffer));
                let response;
                if (data && data.header) {
                    const sampleTime = data.header.timestamp?.toNumber();
                    const gtfsAvailable = await prepareRelevantGtfs(sampleTime, identifier, gtfsFilesIterator, gtfsSource, gtfsrtFile, source.gtfsSchema);
                    if (gtfsAvailable) response = assembleResponse(data, gtfsCache[identifier]['data'], sampleTime, fallBackSampleTime);
                    else response = {response: null, ts: fallBackSampleTime, type: 'gtfsrtTripUpdate', expectedRtCount: 0, err: 'gtfsUnavailable'};
                } else {
                    response = {response: null, ts: fallBackSampleTime, type: 'gtfsrtTripUpdate', expectedRtCount: 0, err: 'invalid gtfsrt file'};
                }
                console.log('prepared response');
                return response;
            } else {
                return null;
            }
        }
    }
}

export {
    extractGtfsrt
}


