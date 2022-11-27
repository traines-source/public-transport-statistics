import pg from 'pg'
import fs from 'fs'
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
const responseTypeMapping = { //Reconstruction==refreshJourney
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

const parseFileTimestamp = (filename) => {
    const match = filename.match(/^.*?(\d+)\.[a-z0-9]+$/);
    if (match != null) {
        return match[1];
    }
    return null;
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
    const files = fs.readdirSync(source.path);
    let minEligibleTs = null;
    let minEligibleFile = null;
    for (const file of files) {
        const ts = parseFileTimestamp(file);
        if (ts != null) {
            if (ts > lastSuccessful && (ts < minEligibleTs || minEligibleTs == null)) {
                minEligibleTs = ts;
                minEligibleFile = file;
            }
        }
    }
    console.log(minEligibleFile)
    return source.path+minEligibleFile;
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

const loadFile = {
    'bz2-bulks': (file) => {
        const uncompressedFile = conf.working_dir+"uncompressed.ndjson";              
        let lines;
        lines = new nReadlines(uncompressedFile);
        return {
            next: () => {
                return new Promise((done, failed) => {
                    const donext = () => {
                        let line;
                        while (line = lines.next()) {
                            const data = JSON.parse(line.toString('utf8'));
                            if (data[1] == 'res') {
                                const res = JSON.parse(data[2]);
                                let type = res.svcResL[0].meth;
                                //console.log(res.svcResL[0]);
                                if (type == 'StationBoard' && res.svcResL[0].res) type = res.svcResL[0].res.type;
                                
                                type = responseTypeMapping[type];
                                if (type) {
                                    console.log(type);
                                    type.fn(res).then(response => {
                                        console.log('test');
                                        done({ value: {response: response, ts: null, type: type.id}, done: false });
                                    });
                                    return;
                                }
                            }
                        }
                        done({ value: null, done: true });                            
                    }
                    if (!lines) {                            
                        exec("bzip2 -k -d -c "+file+" > "+uncompressedFile, (err, stdout, stderr) => {
                            if (err) {
                                err.stderr = stderr;
                                failed(err);
                                return;
                            }              
                            lines = new nReadlines(uncompressedFile);
                            donext();
                        });
                    } else {
                        donext();
                    }                        
                });
            }
        }
    },
    'gzip-single': (file) => {
        let readLines = [];
        const lines = new nReadlines(file);

        return {
            next: () => {
                let line;
                while (line = lines.next()) {
                    if (isNewEntry(line) && readLines.length != 0) {
                        return assembleResponse(readLines).then(response => {
                            readLines = [line];
                            return { value: response, done: false };
                        });                       
                    }
                    readLines.push(line);
                    if (readLines.length > 100000) return;
                }
                return assembleResponse(readLines).then(response => {
                    readLines = [line];
                    return { value: response, done: false };
                });
            }
        }
    }
}




const loadFiles = async (target, lastSuccessful) => {
    for (const source of target.sources) {
        if (source.sourceid == 0) continue;
        const file = findNextFile(source, lastSuccessful);
        //const it = loadFile['bz2-bulks'](file);
        const it = loadFile['gzip-single'](file);
        let result = await it.next();
        let i = 0;
        let w = 0;
        let wo = 0;
        while (!result.done) {
            if (result.value.type == 'journeys'){
                if (result.value.response?.realtimeDataFrom) {
                    w++;
                    console.log(result.value?.ts?.getTime(), result.value.response.realtimeDataFrom, result.value?.ts?.getTime()/1000-result.value.response.realtimeDataFrom);

                } else {
                    wo++;
                }

                //break;
            } 
            i++;
            result = await it.next();
        }
        console.log('responses:', i, wo, w);
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
