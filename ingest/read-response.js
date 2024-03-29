import glob from 'glob';
import fs from 'fs';

import {exec} from 'child_process';

import {extractHafas} from './extract-hafas.js';
import {extractFptf} from './extract-fptf.js';
import {extractGtfsrt} from './extract-gtfsrt.js';
import {conf} from './read-conf.js';

const findFiles = (source, identifier) => {
    return new Promise((done, failed) => {
        glob(source.matches, {}, function (er, files) {
            if (er) {
                failed(er);
                return;
            }
            console.log('Source ', source.sourceid, identifier, files.length, 'files');
            done(files);
        });
    });
}

const ignoreSlot = (filename) => {
    return filename.replace(/\.slot\d\./, '');
}

const getFilesIterator = async (source, identifier) => {
    const files = await findFiles(source, identifier);
    return {
        next: (lastSuccessful) => {
            if (!lastSuccessful) {
                return files[0];
            }
            for (let i=0; i<files.length-1; i++) {
                if (ignoreSlot(lastSuccessful) == ignoreSlot(files[i])) {
                    return files[i+1];
                }
            }
            if (source.restartWhenLastSuccessfullNotMatching && ignoreSlot(lastSuccessful) != ignoreSlot(files[files.length-1])) return files[0];
            return null;
        }
    }
}

const callOnce = (uncompressedFile, identifier) => {
    let calledOnce = false;
    return {
        next: async () => {
            if (!calledOnce) {
                calledOnce = true;
                return uncompressedFile;
            }
            return null;
        }
    }
}

const fileReader = {
    'hafas': extractHafas,
    'fptf': extractFptf,
    'gtfsrt': extractGtfsrt,
    'noop': (uncompressedFile, identifier) => uncompressedFile,
    'callonce': callOnce
}

const decompressFile = (cmdToStdout, file, identifier, slot) => {
    const uncompressedFile = conf.working_dir+identifier+'.'+slot+'.uncompressed';
    return new Promise((done, failed) => {
        exec(cmdToStdout+file+" > "+uncompressedFile, (err, stdout, stderr) => {
            if (err) {
                err.stderr = stderr;
                failed(err);
                return;
            }              
            done({uncompressed: uncompressedFile, file: file});
        });
    });
}

const decompressFolder = (cmd, dirflag, file, identifier, slot) => {
    const uncompressedDir = conf.working_dir+identifier+'.'+slot+'.uncompressed/';
    return new Promise((done, failed) => {
        //done({uncompressed: uncompressedDir, file: file});
        //return;
        fs.rmSync(uncompressedDir, { recursive: true, force: true });
        fs.mkdirSync(uncompressedDir);
        exec(cmd+file+dirflag+uncompressedDir, (err, stdout, stderr) => {
            if (err) {
                err.stderr = stderr;
                failed(err);
                return;
            }              
            done({uncompressed: uncompressedDir, file: file});
        });
    });
}

const fileLoader = {
    'bz2-bulks': (file, identifier, slot) => decompressFile("bzip2 -k -d -c ", file, identifier, slot),
    'bz2-tar': (file, identifier, slot) => decompressFolder("tar -xjf ", " -C " , file, identifier, slot),
    'unzip': (file, identifier, slot) => decompressFolder("unzip ", " -d " , file, identifier, slot),
    'gzip-bulks': (file, identifier, slot) => decompressFile("gzip -k -d -c ", file, identifier, slot),
    'gzip-single': (file, identifier, slot) => Promise.resolve({uncompressed: file, file: file}),
    'none': (file, identifier, slot) => Promise.resolve({uncompressed: file, file: file})
}

const updateLastSuccessful = (lastFile, identifier, update) => {
    const checkpointFile = conf.working_dir+'lastSuccessfuls.json';
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

const uncompressingJobs = {};

const findAndOpenNextFile = async (source, identifier, filesIterator, lastSuccessful) => {
    if (!uncompressingJobs[identifier]) {
        uncompressingJobs[identifier] = {file: null, slot: 'slot0'};
    }
    let uncompressing = uncompressingJobs[identifier];
    let file = filesIterator.next(lastSuccessful);
    if (!file) return {file: null, fileReader: null};    
    if (!uncompressing.file) {
        uncompressing.file = fileLoader[source.compression](file, identifier, uncompressing.slot);
    }
    let loadedFile = await uncompressing.file;
    if (loadedFile.file != file) {
        console.log('TERMINATING. Uncompressed file does not match expected file', loadedFile.file, file);
        throw Error('TERMINATING. Uncompressed file does not match expected file');
    }
    console.log('File', file, 'loaded');
    let nextFile = filesIterator.next(file);
    uncompressing.slot = uncompressing.slot == 'slot0' ? 'slot1' : 'slot0';
    if (nextFile) {
        uncompressing.file = fileLoader[source.compression](nextFile, identifier, uncompressing.slot);
    } else {
        uncompressing.file = null;
    }
    return {file: file, fileReader: await fileReader[source.type](loadedFile.uncompressed, identifier, source)};
}

const responseReader = async (source, identifier, update) => {
    let iterator;
    let filesIterator = await getFilesIterator(source, identifier);
    let lastFile;
    let i = 0;
    return {
        next: (continueWithNextFile) => {
            return new Promise((done, failed) => {
                const renewIterator = () => {
                    console.log('file', identifier, i);
                    const lastSuccessful = updateLastSuccessful(lastFile, identifier, update);
                    if (!continueWithNextFile) {
                        console.log('Stopping loading next file.');
                        done(null);
                        return;
                    }
                    findAndOpenNextFile(source, identifier, filesIterator, lastSuccessful).then(({file, fileReader}) => {
                        iterator = fileReader;
                        lastFile = file;
                        if (!iterator || source.upToFile != undefined && file == source.upToFile) {
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
    responseReader,
    findAndOpenNextFile,
    getFilesIterator
}