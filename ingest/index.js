import pg from 'pg'
import fs from 'fs'
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
                            renewIterator();
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

const loadFiles = async (target, lastSuccessful) => {
    for (const source of target.sources) {
        if (source.sourceid != 0) continue;
        const it = responseReader(source, lastSuccessful);
        let result;
        let i = 0;
        let w = 0;
        let wo = 0;
        while ((result = await it.next())) {
            if (result.type == 'journeys'){
                if (result.response?.realtimeDataFrom) {
                    w++;
                    console.log(result.ts?.getTime(), result.response.realtimeDataFrom, result.ts?.getTime()/1000-result.response.realtimeDataFrom);

                } else {
                    wo++;
                }

                //break;
            }
            i++;
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
