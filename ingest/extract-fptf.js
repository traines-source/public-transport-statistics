import nReadlines from 'n-readlines';
import gzip from 'node-gzip';
import md5 from 'md5'
import {parse} from 'date-fns';

const logEntryDetector = Buffer.from('[').readUint8(0);
const newline = Buffer.from([0x0a]);


const parseLogLineMeta = (line) => {
    const match = line.toString('utf8').match(/^\[(.*?)\] "GET (.*?)" 200/);
    if (match) {
        const ts = parse(match[1], 'dd/MMM/yyyy:HH:mm:ss XXXX', new Date());
        if (ts) {
            const type = match[2].match(/\/(departures|arrivals|trips|journeys)/); //refreshJourney,radar
            return {ts: ts, type: type ? type[1] : type};
        }
    }
    return null;
}

const assembleResponse = async (readLines) => {
    const concatLines = [];
    for (let i=1; i<readLines.length; i++) {
        concatLines.push(readLines[i]);
        if (i+1 < readLines.length) concatLines.push(newline);
    }
    const meta = parseLogLineMeta(readLines[0]);
    let response;
    let expectedCount;
    let err;
    let hash;
    try {
        const raw = await gzip.ungzip(Buffer.concat(concatLines));
        const raw_utf8 = raw.toString('utf-8');
        expectedCount = (raw_utf8.match(/elay": \d+/g) || []).length;
        response = JSON.parse(raw_utf8);
        hash = md5(raw_utf8);
    } catch(e) {
        console.log(e)
        err = e;
    }
    return {response: response, hash: hash, ts: meta?.ts, type: meta?.type, expectedRtCount: expectedCount, err: err};
}

const isNewEntry = (line) => {
    if (line.length > 0 && line.readUint8(0) == logEntryDetector && parseLogLineMeta(line)) {
        return true;
    }
    return false; 
}

const extractFptf = async (file) => {
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

export {
    extractFptf
}
