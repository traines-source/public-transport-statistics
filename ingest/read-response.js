import glob from 'glob'
import fs from 'fs'

import {exec} from 'child_process';

import {extractHafas} from './extract-hafas.js'
import {extractFptf} from './extract-fptf.js'
import {conf} from './read-conf.js'


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
            for (let i=0; i<files.length-1; i++) {
                if (lastSuccessful == files[i]) {
                    done(files[i+1]);
                    return;
                }
            }
            done(null);
        });
    });
}

const fileReader = {
    'hafas': extractHafas,
    'fptf': extractFptf 
}

const decompressFile = (cmdToStdout, sourceid) => {
    const uncompressedFile = conf.working_dir+sourceid+'.uncompressed';
    //return Promise.resolve(uncompressedFile);
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

const updateLastSuccessful = (lastFile, source, target, update) => {
    const checkpointFile = conf.working_dir+'lastSuccessfuls.json';
    const identifier = target+'-'+source.sourceid;
    let checkpoints = {};
    try {
        checkpoints = JSON.parse(fs.readFileSync(checkpointFile));
    } catch (e) {
        console.log('Checkpoint file not present.');
    }
    if (lastFile) {
        checkpoints[identifier] = lastFile;
        if (update) fs.writeFileSync(checkpointFile, JSON.stringify(checkpoints));
    }
    return checkpoints[identifier];
}

const findAndOpenNextFile = async (source, lastSuccessful) => {
    let file = await findNextFile(source, lastSuccessful);
    console.log(file);
    if (!file) return {file: null, fileReader: null};
    let loadedFile = await fileLoader[source.compression](file, source.sourceid);
    console.log('File loaded.');
    return {file: file, fileReader: fileReader[source.type](loadedFile)};
}

const responseReader = (source, target, update) => {
    let iterator;
    let lastFile;
    let i = 0;
    return {
        next: () => {
            return new Promise((done, failed) => {
                const renewIterator = () => {
                    console.log(i);
                    const lastSuccessful = updateLastSuccessful(lastFile, source, target, update);
                    findAndOpenNextFile(source, lastSuccessful).then(({file, fileReader}) => {
                        iterator = fileReader;
                        lastFile = file;
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
                            //done(null);
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

export {
    responseReader
}