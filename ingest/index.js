import pg from 'pg'
import md5 from 'md5'
import glob from 'glob'
import nReadlines from 'n-readlines'
import gzip from 'node-gzip'
import {parse} from 'date-fns'

import  {exec} from 'child_process';

import {createRequire} from 'module'
const require = createRequire(import.meta.url)

import {createClient} from 'hafas-client'
import {defaultProfile} from 'hafas-client/lib/default-profile.js'
import {checkIfResponseIsOk} from 'hafas-client/lib/request.js'

import {profile as dbProfile} from 'hafas-client/p/db/index.js'

const conf = require('./ingest.conf.json')

const logEntryDetector = Buffer.from('[').readUint8(0);
const newline = Buffer.from([0x0a]);


const createRequestMockClient = (baseProfile) => {
    const profile = Object.assign({}, defaultProfile, baseProfile);
    profile.endpoint = undefined;
    profile.request = async (ctx, userAgent, reqData) => {
        const b = ctx.opt.responseData;
        checkIfResponseIsOk({
            body: b,
            errProps: {request: {}, response: b, url: ""}
        });
        const svcRes = b.svcResL[0].res;
        //console.log(svcRes);
        return {
            res: svcRes,
            common: profile.parseCommon({...ctx, res: svcRes}),
        }
    };
    return createClient(profile, 'mock');
}

const client = createRequestMockClient(dbProfile);
const responseTypeMapping = {
    'DEP': {id: 'departures', fn: (resp) => client.departures(dummyStation, {responseData: resp})},
    'ARR': {id: 'arrivals', fn: (resp) => client.arrivals(dummyStation, {responseData: resp})},
    'JourneyDetails': {id: 'trip', fn: (resp) => client.trip('id', {responseData: resp})},
    'TripSearch': {id: 'journeys', fn: (resp) => client.journeys(dummyStation, dummyStation, {responseData: resp})},
    'JourneyGeoPos': {id: 'radar', fn: (resp) => client.radar({north: 1, west: 0, south: 0, east: 1}, {responseData: resp})},
    'Reconstruction': {id: 'refreshJourney', fn: (resp) => client.refreshJourney('token', {responseData: resp})}
}
const getLastInserted = async (schema) => {
    const lastInserted = await pgc.query('SELECT MAX(response_time) AS response_time FROM '+schema+'.response_log');
    return lastInserted.rows[0].response_time;
}

const parseLogLineMeta = (line) => {
    const match = line.toString('utf8').match(/^\[(.*?)\] "GET (.*?)" 200/);
    if (match) {
        const ts = parse(match[1], 'dd/MMM/yyyy:HH:mm:ss XXXX', new Date());
        if (ts) {
            const type = match[2].match(/\/(departures|arrivals|trips|journeys|radar)/); //refreshJourney
            return {ts: ts, type: type ? type[1] : type};
        }
    }
    return null;
}


const findNextFile = (source, lastSuccessful) => {
    return new Promise((done, failed) => {
        glob(source.matches, {}, function (er, files) {
            if (er) {
                failed(er);
                return;
            }
            console.log('Source ID '+source.sourceid+': '+files.length+' files');
            if (!lastSuccessful) {
                done(files[0]);
                return;
            }
            for (let i=0; i<files.length; i++) {
                if (lastSuccessful == files[i]) {
                    done(files[i+1]);
                    return;
                }
            }
            done(null);
        });
    });
}

const assembleResponse = async (readLines) => {
    const concatLines = [];
    for (let i=1; i<readLines.length; i++) {
        concatLines.push(readLines[i]);
        if (i+1 < readLines.length) concatLines.push(newline);
    }
    const meta = parseLogLineMeta(readLines[0]);
    let response;
    try {
        const raw = await gzip.ungzip(Buffer.concat(concatLines));
        response = JSON.parse(raw.toString('utf-8'));
    } catch(e) {
        console.log(e)
    }
    return {response: response, ts: meta.ts, type: meta.type};
}

const isNewEntry = (line) => {
    if (line.length > 0 && line.readUint8(0) == logEntryDetector && parseLogLineMeta(line)) {
        return true;
    }
    return false; 
}

const parseHafasResponse = (line) => {
    const data = JSON.parse(line.toString('utf8'));
    if (Array.isArray(data) && data[1] == 'res') {
        return JSON.parse(data[2]);
    }
    if (data.log) {
        const res = JSON.parse(data.log);
        if (res.svcResL) {
            return res;
        }
    }
    return null;
}

const fileReader = {
    'hafas': (file) => {
        const lines = new nReadlines(file);
        return {
            next: () => {                
                let line;
                while (line = lines.next()) {
                    const res = parseHafasResponse(line);
                    if (res) {
                        let type = res.svcResL[0].meth;
                        if (type == 'StationBoard' && res.svcResL[0].res) type = res.svcResL[0].res.type;
                        
                        type = responseTypeMapping[type];
                        if (type) {
                            return type.fn(res).then(response => {
                                return {response: response, ts: null, type: type.id};
                            }).catch(err => {
                                return {response: null, ts: null, type: type.id, err: err};
                            });
                        }
                    }
                }
                return Promise.resolve(null);
            }
        }
    },
    'fptf': (file) => {
        let readLines = [];
        const lines = new nReadlines(file);
        return {
            next: () => {
                let line;
                if (readLines == null) {
                    return Promise.resolve(null);
                }
                while (line = lines.next()) {
                    if (isNewEntry(line) && readLines.length != 0) {
                        return assembleResponse(readLines).then(response => {
                            readLines = [line];
                            return response;
                        });                       
                    }
                    readLines.push(line);
                    if (readLines.length > 100000) return;
                }
                return assembleResponse(readLines).then(response => {
                    readLines = null;
                    return response;
                });
            }
        }
    }
}

const decompressFile = (cmdToStdout, sourceid) => {
    const uncompressedFile = conf.working_dir+sourceid+'.uncompressed';
    return new Promise((done, failed) => {
        exec(cmdToStdout+" > "+uncompressedFile, (err, stdout, stderr) => {
            if (err) {
                err.stderr = stderr;
                failed(err);
                return;
            }              
            done(uncompressedFile);
        });
    });
}

const fileLoader = {
    'bz2-bulks': (file, sourceid) => decompressFile("bzip2 -k -d -c "+file, sourceid),
    'gzip-bulks': (file, sourceid) => decompressFile("gzip -k -d -c "+file, sourceid),
    'gzip-single': (file, sourceid) => Promise.resolve(file)
}

const findAndOpenNextFile = async (source, lastSuccessful) => {
    let file = await findNextFile(source, lastSuccessful);
    console.log(file);
    if (!file) return {file: null, fileReader: null};
    let loadedFile = await fileLoader[source.compression](file, source.sourceid);
    console.log('File loaded.');
    return {file: file, fileReader: fileReader[source.type](loadedFile)};
}

const responseReader = (source, lastSuccessful) => {
    let iterator;
    let i = 0;
    return {
        next: () => {
            return new Promise((done, failed) => {
                const renewIterator = () => {
                    console.log(i);
                    findAndOpenNextFile(source, lastSuccessful).then(({file, fileReader}) => {
                        iterator = fileReader;
                        lastSuccessful = file;
                        if (!iterator) {
                            done(null);
                            return;
                        }
                        iterate();
                    });
                }
                const iterate = () => {
                    i++;
                    iterator.next().then(value => {
                        if (value) {
                            done(value);
                        } else {
                            done(null);
                            //renewIterator();
                        }
                    });
                }
                if (!iterator) {
                    renewIterator();
                } else {
                    iterate();
                }
            });
        }
    }        
}

const parseStations = (stopOrStations) => {
    const out = [];
    for (let s of stopOrStations) {
        if (!s) continue;
        const child = {
            station_id: s.id,
            name: s.name,
            lon: s.location.longitude, 
            lat: s.location.latitude
        };
        if (s.station) {
            child.parent = s.station.id; 
            out.push({
                station_id: s.station.id,
                name: s.station.name,
                lon: s.station.location.longitude, 
                lat: s.station.location.latitude,
            });
        }
        out.push(child);
    }
    return out;
}

const parseOperator = (operator) => {
    if (!operator) return null;
    return {
        id: operator.id,
        name: operator.name
    }
}

const parseLine = (line) => {
    return {
        line_name: line.name,
        line_fahrtnr: line.fahrtNr,
        line_id: line.id,
        product_type: line.product,
        product_name: line.productName
    }
}

const parseMetadata = (root) => {
    return {
        trip_id: root.tripId,
        remarks: root.remarks,
        cancelled: root.cancelled,
        loadFactor: root.loadFactor,
        operator: parseOperator(root.line.operator),
        ...parseLine(root.line)
    }
}

const parseDeparture = (obj) => {
    return {
        scheduled_time: obj.plannedDeparture,
        projected_time: obj.departure,
        is_departure: true,
        delay_minutes: obj.departureDelay,
        scheduled_platform: obj.plannedDeparturePlatform,
        projected_platform: obj.departurePlatform
    }
}

const parseArrival = (obj) => {
    return {
        scheduled_time: obj.plannedArrival,
        projected_time: obj.arrival,
        is_departure: false,
        delay_minutes: obj.arrivalDelay,
        scheduled_platform: obj.plannedArrivalPlatform,
        projected_platform: obj.arrivalPlatform
    }
}

const parseStopovers = (stopovers, destination, provenance, sample_time) => {
    if (!stopovers) return [];
    const out = [];
    for (let stopover of stopovers) {
        if (stopover.departure) {
            out.push({
                ...parseMetadata(stopover),
                stations: parseStations([stopover.stop]),
                station_id: stopover.stop.id,
                ...parseDeparture(stopover),
                sample_time: sample_time,
                destination_provenance: destination?.id,                
            });
        }
        if (stopover.arrival) {
            out.push({
                ...parseMetadata(leg),
                stations: parseStations([stopover.stop]),
                station_id: stopover.stop.id,
                ...parseArrival(stopover),                    
                sample_time: sample_time,
                destination_provenance: provenance?.id,
            });
        }
    }
    return out;
}

const parseAlternatives = (alternatives, is_departure, sample_time, fallback_station_id) => {
    if (!alternatives) return [];
    const out = [];
    for (let alt of alternatives) {
        out.push({
            ...parseMetadata(alt),
            stations: parseStations([alt.stop, alt.destination, alt.origin]),
            station_id: alt.stop?.id || fallback_station_id,
            scheduled_time: alt.plannedWhen,
            projected_time: alt.when,
            is_departure: is_departure,
            delay_minutes: alt.delay,
            sample_time: sample_time,
            destination_provenance: (is_departure ? alt.destination : alt.origin)?.id,
            scheduled_platform: alt.plannedPlatform,
            projected_platform: alt.platform
        });
        out.push(...parseStopovers(alt.previousStopovers, alt.origin, alt.destination, sample_time));
        out.push(...parseStopovers(alt.nextStopovers, alt.origin, alt.destination, sample_time));    
    }
    return out;
}

const parseTrip = (trip, sample_time) => {
    const out = [
        {
            ...parseMetadata(trip),
            stations: parseStations([trip.origin]),
            station_id: trip.origin.id,
            ...parseDeparture(trip),
            sample_time: sample_time,
            destination_provenance: trip.destination,                
        },
        {
            ...parseMetadata(trip),
            stations: parseStations([trip.destination]),
            station_id: trip.destination.id,
            ...parseArrival(trip),                    
            sample_time: sample_time,
            destination_provenance: trip.origin,
        }
    ];
    out.push(...parseStopovers(trip.stopovers, trip.origin, trip.destination, sample_time));
    out.push(...parseAlternatives(trip.alternatives, true, sample_time, trip.origin.id));
    return out;    
}

const parseJourneys = (journeys, sample_time) => {
    return journeys.map(journey => journey.legs.map(leg => {
        const out = [
            {
                ...parseMetadata(leg),
                stations: parseStations([leg.origin]),
                station_id: leg.origin.id,
                ...parseDeparture(leg),
                sample_time: sample_time,
                destination_provenance: null,                
            },
            {
                ...parseMetadata(leg),
                stations: parseStations([leg.destination]),
                station_id: leg.destination.id,
                ...parseArrival(leg),                    
                sample_time: sample_time,
                destination_provenance: null,
            }
        ];
        out.push(...parseStopovers(leg.stopovers, null, null, sample_time));
        out.push(...parseAlternatives(leg.alternatives, true, sample_time, leg.origin.id));
        return out;
    }).flat()).flat();
}

const parseRt = (obj) => {
    return obj.realtimeDataUpdatedAt || obj.realtimeDataFrom;
}

const parser = {
    'journeys': (journeys) => parseJourneys(journeys.journeys, parseRt(journeys)),
    'departures': (departures) => parseAlternatives(departures.departures, true, parseRt(departures)),
    'arrivals': (arrivals) => parseAlternatives(arrivals.arrivals, false, parseRt(arrivals)),
    'trip': (trip) => parseTrip(trip.trip, parseRt(trip)),
    'refreshJourney': (journey) => parseJourneys([journey.journey], parseRt(journey))
}

const loadFiles = async (target, lastSuccessful) => {
    const lastSuccessfuls = {
        0: null,
        1: '/mnt/lfs/traines-stc/tstp-raw-mirror/data.20221125.log.gz.gz',
        2: '/mnt/lfs/traines-stc/tstp-mirror/responses.big1669381989.ndgz'
    }
    const hashes = [];
    let remaining = true;
    for (const source of target.sources) {
        if (source.sourceid == 0) continue;
        const it = responseReader(source, lastSuccessfuls[source.sourceid]);
        let result;
        let i = 0;
        let w = 0;
        let wo = 0;
        let min = 1000;
        let max = 0;
        let sum = 0;
        let duplicates = 0;
        while ((result = await it.next())) {
            if (!result.type || !result.response) continue;
            const hash = md5(JSON.stringify(result.response));
            if (hashes[hash]) {
                duplicates++;
                continue;
            }
            hashes[hash] = source.sourceid;
            
            if (result.response?.realtimeDataFrom || result.response?.realtimeDataUpdatedAt) {
                w++;
                const diff = result.ts?.getTime()/1000-(result.response.realtimeDataFrom || result.response.realtimeDataUpdatedAt);
                if (diff < min) min = diff;
                if (diff > max) max = diff;
                sum += diff;
            } else {
                wo++;
            }

            //break;
            
            i++;
        }
       

        console.log('responses:', i, wo, w, duplicates);
        console.log('minmaxavg', min, max, sum/w);
    }
}

const pgc = new pg.Client({
    host: conf.host,
    port: conf.port,
    user: conf.user,
    password: conf.password,
});
pgc.connect();

const dummyStation = '8011160';



for (const target of conf.targets) {
    const lastInserted = await getLastInserted(target.schema);    
    loadFiles(target, lastInserted.getTime());
}


pgc
  .end()
  .catch((err) => console.error('error during disconnection', err.stack));
