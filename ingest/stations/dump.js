import db from '../db.js'
import ndjson from 'ndjson'
import fs from 'fs'

var transformStream = ndjson.stringify();

var outputStream = transformStream.pipe(fs.createWriteStream("./hafas-stations.ndjson"));
const stations = await db.getStationDetails('db');
let i = 0;
stations.forEach(s => {
    if (!s.details) return;
    transformStream.write(s.details);
    i++;
    if (i % 10000 == 0) console.log(i, 'stations done.');
});
transformStream.end();

outputStream.on(
	"finish",
	() => console.log('Done.')
);

db.disconnect();