import {responseReader} from './read-response.js'
import {transformSamples} from './transform-samples.js'
import db from './db.js'
import {conf} from './read-conf.js'
import load from './load.js'

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
    if (result.type == 'radar' || result.type == 'location') {
        ctrs.typeRadarOrLocation++;
        return false;
    }
    if (!result.response) {
        ctrs.emptyResponses++;
        return false;
    }
    return true;
}

const shouldContinueWithNextFile = (firstSampleTime, lastSampleTime) => {
    if (firstSampleTime && lastSampleTime && lastSampleTime.getTime()-firstSampleTime.getTime() > 24*60*60*1000) {
        return false;
    }
    return true;
}

const resetCtrs = (ctrs, globalCtrs) => {
    for (const [key, value] of Object.entries(ctrs)) {
        if (!globalCtrs[key]) globalCtrs[key] = 0;
        globalCtrs[key] += value;
        ctrs[key] = 0;
    }
    if (globalCtrs.validResponses % 1000 == 0) {
        console.log('counters:', globalCtrs, new Date());
        console.log('perf', globalCtrs.perf_read/globalCtrs.perf_ctr, globalCtrs.perf_parse/globalCtrs.perf_ctr, globalCtrs.perf_persist/globalCtrs.perf_ctr);
        globalCtrs.perf_read = 0;
        globalCtrs.perf_parse = 0;
        globalCtrs.perf_persist = 0;
        globalCtrs.perf_ctr = 0;
    }
}

const processSamples = async (target) => {
    let responseHashes = {};
    let sampleHashes = {};
    let errorOccurred = false;
    let targetFirstSampleTime = undefined;
    let foreignFields = await load.loadForeignFields(target);
    
    for (const source of target.sources) {
        if (source.disabled) continue;

        const identifier = target.schema+'-'+source.sourceid;
        const it = await responseReader(source, identifier, true);

        let result;
        const ctrs = {
            errors: 0,
            unknownTypes: 0,
            typeRadarOrLocation: 0,
            emptyResponses: 0,
            duplicateResponses: 0,
            validResponses: 0,
            samples: 0,
            rtSamples: 0,
            incorrectRtCount: 0,
            missingRts: 0,
            excessRts: 0,
            relevantSamples: 0,
            persistedSamples: 0,
            outside24h: 0,
            outside24hWithRt: 0,
            outside6Months: 0,
            delayGreater12h: 0,
            delayLargeNegative: 0,
            missingSampleTime: 0,
            fallbackSampleTime: 0,
            skippedSamples: 0,
            sampleDuplicates: 0,
            remarks: 0,
            cancelled: 0,
            perf_read: 0,
            perf_stringify: 0,
            perf_parse: 0,
            perf_persist: 0,
            perf_ctr: 0,
            rtDiffSum: 0,
            rtDiffCount: 0
        }
        const globalCtrs = {};
        let perf_start = performance.now();
        let continueWithNextFile = true;
        while ((result = await it.next(continueWithNextFile))) {
            console.log('start response', performance.now()-perf_start);
            ctrs.perf_read += performance.now()-perf_start;
            ctrs.perf_ctr++;
            perf_start = performance.now();
            
            if (!validateResult(result, ctrs)) {
                if (result.err == 'gtfsUnavailable') {
                    errorOccurred = true;
                    break;
                }
                continue;
            }
            console.log('validated');

            if (responseHashes[result.hash]) {
                ctrs.duplicateResponses++;
                continue;
            }
            responseHashes[result.hash] = true;
            ctrs.validResponses++;            

            const samples = transformSamples[result.type](result.response);
   
            console.log('start commit', performance.now()-perf_start);
            ctrs.perf_parse += performance.now()-perf_start;
            perf_start = performance.now();

            const signal = Array.isArray(samples)
            ? await load.loopSamples(samples, ctrs, result, target, source, sampleHashes, foreignFields)
            : await load.streamSamples(samples, ctrs, result, target, source);            
            if (!targetFirstSampleTime) targetFirstSampleTime = signal.firstSampleTime;
            errorOccurred = signal.errorOccurred;
            continueWithNextFile = shouldContinueWithNextFile(targetFirstSampleTime, signal.lastSampleTime);
            
            console.log('end commit', performance.now()-perf_start);
            ctrs.perf_persist += performance.now()-perf_start;
            perf_start = performance.now();

            resetCtrs(ctrs, globalCtrs);
            if (globalCtrs.validResponses % 10000 == 0) {
                responseHashes = {};
                sampleHashes = {};
            }
        }

        console.log('finished source');
        console.log('counters:', globalCtrs, new Date());
        console.log('rtDiff minmaxavg', globalCtrs.rtDiffSum/globalCtrs.rtDiffCount);
        if (errorOccurred) {
            console.log('TERMINATING due to error.');
            break;
        }
    }
    if (!errorOccurred) {
        //await db.updateMaterializedHistograms(target.schema);
    }
    return !errorOccurred && targetFirstSampleTime;
}

console.log("===========");
console.log("Starting...");
console.log("===========");
let shallContinue = true;
while (shallContinue) {
    console.log('Iterating targets...');
    for (const target of conf.targets) {
        if (target.disabled) continue;
        shallContinue = await processSamples(target) && shallContinue;
    }
}

db.disconnect();