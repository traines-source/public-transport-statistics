import csv from 'csv-parser';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import {findAndOpenNextFile, getFilesIterator} from './read-response.js'


const findFiles = (dir) => {
    return new Promise((done, failed) => {
        glob(dir+'*/*.gtfsrt', {}, function (er, files) {
            if (er) {
                failed(er);
                return;
            }
            done(files);
        });
    });
}

const getValidUntil = (gtfsFilesIterator, current) => {
    const next = gtfsFilesIterator.next(current);
    if (next) {
        const mtime = new Date(fs.statSync(next).mtimeMs);
        return new Date(mtime.getFullYear, mtime.getMonth(), mtime.getDate(), 14, 0, 0, 0).getTime()/1000;
    }
    return null;
}

const gtfsCache = {};


const parseCsv = async (file, setRow, columns) => {
    return new Promise((done) => {
        fs.createReadStream(file)
        .pipe(csv(columns))
        .on('data', setRow)
        .on('end', () => {
            console.log('done reading', file);
            done(true);
        });
    });
}

const parseGtfsCsv = async (cache, directory, type, key, columns) => {
    const results = {};
    await parseCsv(directory+type+'.txt', (row) => results[row[key]] = row, [key, ...columns]);
    cache[type] = results;
}

const loadGtfs = (directory, identifier) => {
    const cache = gtfsCache[identifier]['data'];
    await parseGtfsCsv(cache, directory, 'agency', 'agency_id', ['agency_name']);
    await parseGtfsCsv(cache, directory, 'stops', 'stop_id', ['stop_name', 'stop_lat', 'stop_lon', 'parent_station', 'platform_code']);
    await parseGtfsCsv(cache, directory, 'routes', 'route_id', ['agency_id', 'route_short_name', 'route_type', 'route_desc']);
    await parseGtfsCsv(cache, directory, 'trips', 'trip_id', ['route_id', 'trip_short_name']);
    await parseGtfsCsv(cache, directory, 'stop_times', 'trip_id', ['arrival_time', 'departure_time', 'stop_id', 'stop_sequence']);
    await parseCsv(directory+type+'.txt', (row) => {
        const trip = cache['trips'][row['trip_id']];
        if (!trip['stop_times']) trip['stop_times'] = [];
        trip['stop_times'].push(row);
    }, ['trip_id', 'arrival_time', 'departure_time', 'stop_id', 'stop_sequence']);
}

const prepareRelevantGtfs = async (timestamp, identifier, gtfsFilesIterator, gtfsSource, gtfsrtFile) => {
    let previousGtfs = undefined;
    while (timestamp > gtfsCache[identifier]['validUntil']) {
        previousGtfs = gtfsCache[identifier]['file'];
        gtfsCache[identifier]['file'] = filesIterator.next(gtfsCache[identifier]['file']);
        gtfsCache[identifier]['validUntil'] = getValidUntil(gtfsFilesIterator, currentGtfs);
        if (!gtfsCache[identifier]['file'] || !gtfsCache[identifier]['validUntil']) {
            throw new Error('missing up to date GTFS');
        }
    }
    if (previousGtfs != undefined) {
        console.log('Switching to GTFS', gtfsCache[identifier]['file'], 'for GTFSRT', gtfsrtFile);
        const open = await findAndOpenNextFile(gtfsSource, identifier, gtfsFilesIterator, previousGtfs);
        if (open.file != gtfsCache[identifier]['file'])
            throw Error('file mismatch');
        gtfsCache[identifier]['data'] = loadGtfs(open.fileReader);
    }
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
    const out = [];
    const s = gtfs.stops[stopId];
    if (!s) continue;
    const child = {
        station_id: s.stop_id,
        name: s.stop_name,
        lon: s.stop_lon, 
        lat: s.stop_lat
    };
    if (s.parent_station) {
        child.parent = s.parent_station; 
        const p = gtfs.stops[stopId];
        out.push({
            station_id: p.stop_id,
            name: p.stop_name,
            lon: p.stop_lon, 
            lat: p.stop_lat
        });
    }
    out.push(child);
    return out;
}

const joinTime = (startDate, scheduledTimeStr, realTime, interpolated)  => {
    const parts = scheduledTimeStr.split(':');
    const hours = parseInt(parts[0]);
    const minutes = parseInt(parts[1]);
    const seconds = parseInt(parts[3]);

    let scheduledDatetime;
    let realDatetime = null;
    let delaySeconds = null;

    if (!startDate) throw Error('Date fallback not implemented');
    const noonMinus12 = new Date(parseInt(startDate.substring(0,4)), parseInt(startDate.substring(4,6))-1, parseInt(startDate.substring(6,8)), 12).getTime()/1000-12*60*60;
    scheduledDatetime = new Date((noonMinus12+(hours*60+minutes)*60+seconds)*1000);

    if (realTime && realTime.delay) {
        delaySeconds = realTime.delay.toNumber();
        realDatetime = new Date(scheduledDatetime.getTime()+delaySeconds*1000);
    } else if (realTime &&  realTime.time && !interpolated) {
        delaySeconds = realTime.time.toNumber()-scheduledDatetime.getTime()/1000;
        if (delaySeconds > 12*60*60) throw Error('Delay of more than 12 hours');
        realDatetime = new Date(realTime.time.toNumber()*1000);
    }
    
    return {scheduled: scheduledDatetime, real: realDatetime, delay: delaySeconds}
}

const populateSample = (meta, is_departure, time, destination_provenance_id, previousSample) => {
    const s = {
        ...meta,
        scheduled_time: time.scheduled,
        projected_time: time.real,
        delay_seconds: time.delay,
        is_departure: is_departure,                        
        destination_provenance_id: destination_provenance_id
    };
    if (previousSample) {
        previousSample.scheduled_duration = (s.scheduled_time.getTime()-previousSample.scheduled_time.getTime())/1000;
        previousSample.projected_duration = (s.projected_time.getTime()-previousSample.projected_time.getTime())/1000;
    }
    return s;
}

// todo offline samples, update schema (int2str, duration), incremental matview
const assembleResponse = async (data, identifier, sampleTime) => {
    const samples = [];
    const gtfs = gtfsCache[identifier]['data'];
    for (let i=0; i<data.entity.length; i++) {
        if (data.entity[i].trip_update) {
            const u = data.entity[i].trip_update;
            const trip = gtfs.trips[u.trip.trip_id];
            if (!trip) continue;
            const route = gtfs.routes[trip.route_id];

            let stopTimeUpdate = null;
            let previousSample = null;
            let jUpdate = 0;
            for (let j=0; j<trip.stop_times; j++) {
                const stopTime = trip.stop_times[j];
                if (u.stop_time_update?.length > jUpdate+1 && u.stop_time_update[jUpdate+1].stop_id == stopTime.stop_id) jUpdate++;
                if (u.stop_time_update && u.stop_time_update[jUpdate].stop_id == stopTime.stop_id) stopTimeUpdate = u.stop_time_update[jUpdate];

                const meta = {
                    cancelled: u.schedule_relationship == GtfsRealtimeBindings.transit_realtime.TripDescriptor.ScheduleRelationship.CANCELED ||
                        stopTimeUpdate?.schedule_relationship == GtfsRealtimeBindings.transit_realtime.StopTimeUpdate.ScheduleRelationship.SKIPPED,
                    sample_time: sampleTime,
                    trip_id: trip.trip_id,
                    line_name: route.route_short_name,
                    line_fahrtnr: trip.trip_short_name,
                    product_type: productType(parseInt(route.route_type)),
                    product_name: route.route_type,
                    station_id: stopTime.stop_id,
                    stations: parseStations(stopTime.stop_id),
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
                if (stopTimeUpdate?.arrival || meta.cancelled && stopTime.arrival_time) {
                    let time = joinTime(u.start_date, stopTime.arrival_time, stopTimeUpdate?.arrival, stopTimeUpdate?.stop_id != stopTime.stop_id);
                    previousSample = populateSample(meta, false, time, trip.stop_times[0].stop_id, previousSample)
                    samples.push(previousSample);
                }
                if (stopTimeUpdate?.departure || meta.cancelled && stopTime.departure_time) {
                    let time = joinTime(u.start_date, stopTime.departure_time, stopTimeUpdate?.departure, stopTimeUpdate?.stop_id != stopTime.stop_id);
                    previousSample = populateSample(meta, true, time, trip.stop_times[trip.stop_times.length-1].stop_id, previousSample)
                    samples.push(previousSample);
                } else {
                    previousSample = null;
                }
            }
        } else {
            console.log('ignoring entity type');
        }
    }    
    return {response: samples, ts: sampleTime, type: 'gtfsrt', expectedRtCount: samples.length, err: null};
}

const extractGtfsrt = (dir, identifier) => {
    const gtfsSource = {
        "sourceid": 0,
        "matches": "/mnt/lfs/traines-stc/mirror/swiss-gtfs/*/*.zip",
        "compression": "unzip",
        "type": "noop"
    }
    identifier += '-gtfs';
    const gtfsrtFiles = findFiles(dir);
    const gtfsFilesIterator = await getFilesIterator(gtfsSource);
    
    let i = 0;
    if (!gtfsCache[identifier]) {
        gtfsCache[identifier]['file'] = null;
        gtfsCache[identifier]['validUntil'] = 0;
        gtfsCache[identifier]['data'] = {};
    }
   
    return {
        next: () => {
            if (i < gtfsrtFiles.length) {
                const buffer = fs.readFileSync(gtfsrtFiles[i]);
                const data = GtfsRealtimeBindings.transit_realtime.FeedMessage.toObject(GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(buffer));
                if (data && data.header) {
                    let mtime = data.header.timestamp ? data.header.timestamp.toNumber() : fs.statSync(next).mtimeMs/1000;
                    await prepareRelevantGtfs(mtime, identifier, gtfsFilesIterator, gtfsSource, gtfsrtFiles[i]);
                    return assembleResponse(data, gtfsCache[identifier]['data'], mtime);
                }
                i++;
            } else {
                return null;
            }
        }
    }
}

export {
    extractGtfsrt
}


