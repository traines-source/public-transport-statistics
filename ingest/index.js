import pg from 'pg'
import md5 from 'md5'
import {responseReader} from './read-response.js'
import {transformSample} from './transform-sample.js'
import {conf} from './read-conf.js'


const getLastInserted = async (schema) => {
    const lastInserted = await pgc.query('SELECT MAX(response_time) AS response_time FROM '+schema+'.response_log');
    return lastInserted.rows[0].response_time;
}

const loadFiles = async (target, lastSuccessful) => {
    const lastSuccessfuls = {
        0: '/mnt/lfs/traines-stc/teak-mirror/a.v5.db.transport.rest.ndjson1669417200.bz2',
        1: '/mnt/lfs/traines-stc/tstp-raw-mirror/data.20221125.log.gz.gz',
        2: '/mnt/lfs/traines-stc/tstp-mirror/responses.big1669381989.ndgz'
    }
    const hashes = [];
    let remaining = true;
    for (const source of target.sources) {
        if (source.sourceid != 0) continue;
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
            if (result.err) console.log(result.err);
            if (!result.type || !result.response) {                            
                if (result.expectedRtCount > 0) console.log('WARN: discarding response containing rtData', result.expectedRtCount);
                continue;
            }
            const str = JSON.stringify(result.response);
            const hash = md5(str);
            if (hashes[hash]) {
                duplicates++;
                continue;
            }
            hashes[hash] = source.sourceid;

            /*f (result.type == 'departures') {
                break;
            }*/

            const extracted = transformSample[result.type](result.response);
            //console.log(extracted);
           
            const actualCount = extracted.filter(e => e.delay_minutes != null).length;
            if (result.expectedRtCount != actualCount && result.type =="refreshJourney") {
                console.log('noooooooooo', result.expectedRtCount, actualCount, extracted.length, result.type);//, JSON.stringify(result.response), extracted);
                //break;
            }
            //break;
            
            if (result.response?.realtimeDataFrom || result.response?.realtimeDataUpdatedAt) {
                w++;
                const diff = result.ts?.getTime()/1000-(result.response.realtimeDataFrom || result.response.realtimeDataUpdatedAt.legs);
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

for (const target of conf.targets) {
    const lastInserted = await getLastInserted(target.schema);    
    loadFiles(target, lastInserted.getTime());
}

pgc
  .end()
  .catch((err) => console.error('error during disconnection', err.stack));
