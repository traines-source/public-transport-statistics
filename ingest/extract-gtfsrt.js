import csv from 'csv-parser';
import stripBomStream from 'strip-bom-stream';
import md5 from 'md5'
import fs from 'fs';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import {findAndOpenNextFile, getFilesIterator, responseReader} from './read-response.js';

const randomOfflineSamplesNumber = 3;

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

const loadGtfs = async (cache, directory, identifier) => {
    await parseGtfsCsv(cache, directory, 'agency', 'agency_id', ['agency_name']);
    await parseGtfsCsv(cache, directory, 'stops', 'stop_id', ['stop_name', 'stop_lat', 'stop_lon', 'parent_station', 'platform_code']);
    await parseGtfsCsv(cache, directory, 'routes', 'route_id', ['agency_id', 'route_short_name', 'route_type', 'route_desc']);
    await parseGtfsCsv(cache, directory, 'trips', 'trip_id', ['route_id', 'trip_short_name']);
    console.log(Object.keys(cache['trips']).length, cache['trips'][Object.keys(cache['trips'])[0]]);
    await parseCsv(directory+'stop_times.txt', (row) => {
        //console.log(row['trip_id'], row);
        const trip = cache['trips'][row['trip_id']];
        if (!trip['stop_times']) trip['stop_times'] = [];
        trip['stop_times'].push(filterFields(row, ['arrival_time', 'departure_time', 'stop_id', 'stop_sequence']));
    });
}

const prepareRelevantGtfs = async (timestamp, identifier, gtfsFilesIterator, gtfsSource, gtfsrtFile) => {
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
        console.log('Switching to GTFS', gtfsCache[identifier]['file'], 'for GTFSRT', gtfsrtFile);
        const open = await findAndOpenNextFile(gtfsSource, identifier, gtfsFilesIterator, previousGtfs);
        if (open.file != gtfsCache[identifier]['file'])
            throw Error('file mismatch');
        await loadGtfs(gtfsCache[identifier]['data'], open.fileReader, identifier);
    }
    return true;
}

const productType = (id) => {
    // TODO not only switzerland
    if (id >= 700 && id < 800) return 'bus';
    if (id >= 200 && id < 300) return 'bus';
    if (id >= 200 && id < 300) return 'coach';
    if (id >= 400 && id < 500) return 'metro';
    if (id >= 900 && id < 1000) return 'tram';
    if (id >= 101 && id < 103) return 'nationalExpress';
    if (id >= 105 && id < 106) return 'nationalExpress';
    if (id >= 100 && id < 104) return 'regionalExpress';
    if (id >= 104 && id < 109) return 'regional';
    if (id >= 109 && id < 110) return 'suburban';
    return 'special';
}

const parseStations = (stopId, gtfs) => {
    if (gtfs.stops_persisted) return [];
    const out = [];
    const keys = Object.keys(gtfs.stops);
    for (let key of keys) {
        const s = gtfs.stops[key];
        out.push({
            station_id: s.stop_id,
            name: s.stop_name,
            lon: s.stop_lon, 
            lat: s.stop_lat,
            parent: s.parent_station ? s.parent_station : null
        });    
    }
    gtfs.stops_persisted = true;
    return out;
}

const splitTimeStr = (s) => {
    const parts = s.split(':');
    return {
        hours: parseInt(parts[0]),
        minutes: parseInt(parts[1]),
        seconds: parseInt(parts[2])
    };
}

const calculateStartTime = (trip, tripUpdate) => {
    const scheduled = splitTimeStr(trip.stop_times[0].departure_time);
    const startDate = tripUpdate.trip.startDate;
    const startTime = tripUpdate.trip.startTime ? splitTimeStr(tripUpdate.trip.startTime) : scheduled;
    const noonMinus12 = new Date(
        parseInt(startDate.substring(0,4)),
        parseInt(startDate.substring(4,6))-1,
        parseInt(startDate.substring(6,8)),
        12+startTime.hours-scheduled.hours
    ).getTime()/1000-12*60*60;
    return noonMinus12;
}

const joinTime = (startTime, scheduledTimeStr, realTime, previousDelay)  => {
    const scheduledTime = splitTimeStr(scheduledTimeStr);
    let scheduledDatetime;
    let realDatetime = null;
    let delaySeconds = null;

    if (!startTime) throw Error('Date fallback not implemented');
    scheduledDatetime = (startTime+(scheduledTime.hours*60+scheduledTime.minutes)*60+scheduledTime.seconds)*1000;

    if (realTime && realTime.delay != undefined) {
        delaySeconds = realTime.delay;
        realDatetime = scheduledDatetime+delaySeconds*1000;
    } else if (realTime && realTime.time) {
        delaySeconds = realTime.time.toNumber()-scheduledDatetime/1000;
        realDatetime = realTime.time.toNumber()*1000;
    } else if (previousDelay != null) {
        delaySeconds = previousDelay;
        realDatetime = scheduledDatetime+delaySeconds*1000;
    }
    
    return {scheduled: scheduledDatetime, real: realDatetime, delay: delaySeconds}
}

const populateSample = (meta, is_departure, time, destination_provenance_id, previousSample) => {
    const s = {
        ...meta,
        scheduled_time: time.scheduled,
        projected_time: meta.cancelled ? null : time.real,
        delay_seconds: meta.cancelled ? null : time.delay,
        is_departure: is_departure,                        
        destination_provenance_id: destination_provenance_id
    };
    if (previousSample) {
        previousSample.scheduled_duration_minutes = Math.round((s.scheduled_time-previousSample.scheduled_time)/1000/60);
        if (s.projected_time && previousSample.projected_time) {
            previousSample.projected_duration_minutes = Math.round((s.projected_time-previousSample.projected_time)/1000/60);
        }
    }
    return s;
}

const matchesStopTime = (stopTime, stopTimeUpdate) => {
    return stopTimeUpdate?.stopId == stopTime.stop_id || stopTimeUpdate?.stopSequence == parseInt(stopTime.stop_sequence)
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
    const tripCancelled = tripUpdate.trip.scheduleRelationship == GtfsRealtimeBindings.transit_realtime.TripDescriptor.ScheduleRelationship.CANCELED;
    const startTime = calculateStartTime(trip, tripUpdate);
    let previousSample = null;
    let jUpdate = 0;
    let expectedRtCount = 0;
    let previousDelay = null;
    let previousCancelled = false;
    for (let j=0; j<trip.stop_times.length; j++) {
        const stopTime = trip.stop_times[j];
        let stopTimeUpdate = null;
        if (tripUpdate.stopTimeUpdate?.length > jUpdate+1 && matchesStopTime(stopTime, tripUpdate.stopTimeUpdate[jUpdate+1])) {
            jUpdate++;
            stopTimeUpdate = tripUpdate.stopTimeUpdate[jUpdate];
        } else if (jUpdate == 0 && tripUpdate.stopTimeUpdate && matchesStopTime(stopTime, tripUpdate.stopTimeUpdate[jUpdate])) {
            stopTimeUpdate = tripUpdate.stopTimeUpdate[jUpdate];
        }

        const meta = {
            cancelled: isCancelled(tripCancelled, stopTimeUpdate, previousCancelled),
            sample_time: sampleTime,
            trip_id: trip.trip_id,
            line_name: route.route_short_name,
            line_fahrtnr: trip.trip_short_name,
            product_type: productType(parseInt(route.route_type)),
            product_name: route.route_type,
            station_id: stopTime.stop_id,
            stations: parseStations(stopTime.stop_id, gtfs),
            operator:  {
                id: route.agency_id,
                name: gtfs.agency[route.agency_id].agency_name
            },
            stop_number: parseInt(stopTime.stop_sequence),
            //remarks, 
            //scheduled_platform
            //projected_platform
            //load_factor
            //response_id
        }
        previousCancelled = meta.cancelled;
        if ((stopTimeUpdate?.arrival || stopTime.arrival_time) && j != 0) {
            let time = joinTime(startTime, stopTime.arrival_time, stopTimeUpdate?.arrival, previousDelay);
            previousDelay = time.delay;            
            previousSample = populateSample(meta, false, time, trip.stop_times[0].stop_id, previousSample)
            samples.push(previousSample);
            if (time.delay != null && !meta.cancelled) expectedRtCount++;
        }
        if ((stopTimeUpdate?.departure || stopTime.departure_time) && j != trip.stop_times.length-1) {
            let time = joinTime(startTime, stopTime.departure_time, stopTimeUpdate?.departure, previousDelay);
            previousDelay = time.delay;
            previousSample = populateSample(meta, true, time, trip.stop_times[trip.stop_times.length-1].stop_id, previousSample)
            samples.push(previousSample);
            if (time.delay != null && !meta.cancelled) expectedRtCount++;
        } else {
            previousSample = null;
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

const assembleResponse = async (data, gtfs, sampleTime, fallbackSampleTime) => {
    const samples = [];
    let expectedRtCount = 0;
    let unknownEntityType = 0;
    let unscheduled = 0;
    for (let i=0; i<data.entity.length; i++) {
        if (data.entity[i].tripUpdate) {
            const tripUpdate = data.entity[i].tripUpdate;
            const trip = gtfs.trips[tripUpdate.trip.tripId];
            if (!trip || !trip.stop_times?.length) {
                unknownEntityType++
                continue;
            }
            if (tripUpdate.trip.scheduleRelationship != GtfsRealtimeBindings.transit_realtime.TripDescriptor.ScheduleRelationship.SCHEDULED
                && tripUpdate.trip.scheduleRelationship != GtfsRealtimeBindings.transit_realtime.TripDescriptor.ScheduleRelationship.CANCELED) {
                    unscheduled++;
                    continue;
                }
            createRandomOfflineSamples(gtfs, trip, tripUpdate, sampleTime, samples);
            expectedRtCount += handleTrip(gtfs, trip, tripUpdate, sampleTime, samples);            
        } else {
            unknownEntityType++;
        }
    }
    console.log('number of unknown, unscheduled entities vs total', unknownEntityType, unscheduled, data.entity.length);
    return {response: samples, hash: md5(fallbackSampleTime), ts: fallbackSampleTime, type: 'gtfsrtTripUpdate', expectedRtCount: expectedRtCount, err: null};
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
                    const gtfsAvailable = await prepareRelevantGtfs(sampleTime, identifier, gtfsFilesIterator, gtfsSource, gtfsrtFile);
                    if (gtfsAvailable) response = await assembleResponse(data, gtfsCache[identifier]['data'], sampleTime, fallBackSampleTime);
                    else response = {response: null, ts: fallBackSampleTime, type: 'gtfsrtTripUpdate', expectedRtCount: 0, err: 'gtfsUnavailable'};
                } else {
                    response = {response: null, ts: fallBackSampleTime, type: 'gtfsrtTripUpdate', expectedRtCount: 0, err: 'invalid gtfsrt file'};
                }
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


