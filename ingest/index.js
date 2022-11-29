import pg from 'pg'
import md5 from 'md5'
import {responseReader} from './read-response.js'
import {transformSamples} from './transform-samples.js'
import {conf} from './read-conf.js'


const getLastInserted = async (schema) => {
    const lastInserted = await pgc.query('SELECT MAX(response_time) AS response_time FROM '+schema+'.response_log');
    return lastInserted.rows[0].response_time;
}

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

const loadFiles = async (target, lastSuccessful) => {
    const lastSuccessfuls = {
        0: '/mnt/lfs/traines-stc/teak-mirror/a.v5.db.transport.rest.ndjson1669417200.bz2',
        1: '/mnt/lfs/traines-stc/tstp-raw-mirror/data.20221125.log.gz.gz',
        2: '/mnt/lfs/traines-stc/tstp-mirror/responses.big1669381989.ndgz'
    }
    const hashes = [];
    for (const source of target.sources) {
        if (source.disabled) continue;

        const it = responseReader(source, lastSuccessfuls[source.sourceid]);

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
            incorrectRtCount: 0
        }

        while ((result = await it.next())) {
            if (!validateResult(result, ctrs)) {
                continue;
            }
            const str = JSON.stringify(result.response);
            const hash = md5(str);
            if (hashes[hash]) {
                ctrs.duplicates++;
                continue;
            }
            hashes[hash] = source.sourceid;
            ctrs.validResponses++;

            const extracted = transformSamples[result.type](result.response);
            const actualCount = extracted.filter(e => e.delay_minutes != null).length;

            ctrs.samples += extracted.length;
            ctrs.rtSamples += actualCount;
           
            if (result.expectedRtCount != actualCount) {
                ctrs.incorrectRtCount++;
                //console.log('incorrectRtCount:', result.expectedRtCount, actualCount, extracted.length, result.type);//, JSON.stringify(result.response), extracted);
                //break;
            }
            
            if (result.response?.realtimeDataFrom || result.response?.realtimeDataUpdatedAt) {
                rtDiffCount++;
                const diff = result.ts?.getTime()/1000-(result.response.realtimeDataFrom || result.response.realtimeDataUpdatedAt.legs);
                if (diff < rtDiffMin) rtDiffMin = diff;
                if (diff > rtDiffMax) rtDiffMax = diff;
                rtDiffSum += diff;
            }
        }       

        console.log('counters:', ctrs);
        console.log('rtDiff minmaxavg', rtDiffMin, rtDiffMax, rtDiffSum/rtDiffCount);
    }
}

const pgc = new pg.Client({
    host: conf.host,
    port: conf.port,
    user: conf.user,
    password: conf.password,
});
pgc.connect();

for (const target of conf.targets) {
    const lastInserted = await getLastInserted(target.schema);    
    loadFiles(target, lastInserted.getTime());
}

pgc
  .end()
  .catch((err) => console.error('error during disconnection', err.stack));
