import nReadlines from 'n-readlines';
import md5 from 'md5'

import {createClient} from 'hafas-client';
import {defaultProfile} from 'hafas-client/lib/default-profile.js';
import {checkIfResponseIsOk} from 'hafas-client/lib/request.js';
import {profile as dbProfile} from 'hafas-client/p/db/index.js';


const dummyStation = '8011160';

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
        return {
            res: svcRes,
            common: profile.parseCommon({...ctx, res: svcRes}),
        }
    };
    return createClient(profile, 'mock');
}

const hafasClient = createRequestMockClient(dbProfile);

const responseTypeMapping = {
    'DEP': {id: 'departures', fn: (resp) => hafasClient.departures(dummyStation, {responseData: resp})},
    'ARR': {id: 'arrivals', fn: (resp) => hafasClient.arrivals(dummyStation, {responseData: resp})},
    'JourneyDetails': {id: 'trip', fn: (resp) => hafasClient.trip('id', {responseData: resp, stopovers: true})},
    'TripSearch': {id: 'journeys', fn: (resp) => hafasClient.journeys(dummyStation, dummyStation, {responseData: resp, stopovers: true})},
    //'JourneyGeoPos': {id: 'radar', fn: (resp) => hafasClient.radar({north: 1, west: 0, south: 0, east: 1}, {responseData: resp})},
    'Reconstruction': {id: 'refreshJourney', fn: (resp) => hafasClient.refreshJourney('token', {responseData: resp, stopovers: true})}
}

const countRt = (raw_utf8) => {
    return (raw_utf8.match(/TimeR/g) || []).length;
}

const unmarshalHafasResponse = (line) => {
    try {
        const data = JSON.parse(line);
        if (Array.isArray(data) && data[1] == 'res') {
            return JSON.parse(data[2]);
        }
        if (data.log) {
            const res = JSON.parse(data.log);
            if (res.svcResL) {
                return res;
            }
        }
        if (data.svcResL) {
            return data;
        }
    } catch (e) {
        console.log('Invalid json log.', e);
    }
    return null;
}

const extractHafas = async (file) => {
    const lines = new nReadlines(file);
    return {
        next: () => {                
            let line;
            while (line = lines.next()) {
                const raw_utf8 = line.toString('utf8');
                const res = unmarshalHafasResponse(raw_utf8);
                if (res) {
                    const expectedCount = countRt(raw_utf8);
                    let type = res.svcResL ? res.svcResL[0]?.meth : null;
                    if (type == 'StationBoard' && res.svcResL[0].res) type = res.svcResL[0].res.type;
                    
                    type = responseTypeMapping[type];
                    if (type) {
                        return type.fn(res).then(response => {
                            const hash = md5(raw_utf8);
                            return {response: response, hash: hash, ts: null, type: type.id, expectedRtCount: expectedCount};
                        }).catch(err => {
                            return {response: null, ts: null, type: type.id, err: err, expectedRtCount: expectedCount};
                        });
                    }
                    let ctrsType = null;
                    if (res.svcResL && res.svcResL[0].meth == 'JourneyGeoPos') ctrsType = 'radar';
                    if (res.svcResL && res.svcResL[0].meth == 'LocMatch') ctrsType = 'location';
                    return Promise.resolve({response: null, ts: null, type: ctrsType, err: null, expectedRtCount: expectedCount})
                }
            }
            return Promise.resolve(null);
        }
    }
}

export {
    extractHafas
}