import db from '../db.js'
import ndjson from 'ndjson'
import fs from 'fs'

console.log('starting...');

const buffer = fs.readFileSync("/data/D_Bahnhof_2020_alle.CSV");
const rows = buffer.toString().split('\n');

function parseGeo(l) {
    if (!l)  {
        console.log('Encountered NaN');
        return NaN;
    }
    return parseFloat(l.replace(',', '.'));
}

function geoDist(lon1, lat1, lon2, lat2) {
    const φ1 = lat1 * Math.PI/180, φ2 = lat2 * Math.PI/180, Δλ = (lon2-lon1) * Math.PI/180, R = 6371e3;
    return Math.acos( Math.sin(φ1)*Math.sin(φ2) + Math.cos(φ1)*Math.cos(φ2) * Math.cos(Δλ) ) * R;
}

const evaNrMap = {};
for (let i=0; i<rows.length; i++) {
    const cols = rows[i].split(';');
    evaNrMap[cols[0]] = {'ifoptId': cols[2], 'name': cols[3], 'lon': parseGeo(cols[5]), 'lat': parseGeo(cols[6])};
}

var transformStream = ndjson.stringify();

var outputStream = transformStream.pipe(fs.createWriteStream("/data/hafas-stations.ndjson"));
console.log('fetching from DB...');
const stations = await db.getStationDetails('db');
console.log('reading...');
let i = 0;
const wrongPositionHafas = [];
stations.forEach(s => {
    if (!s.details) {
        s.details = {
            "id": s.station_id+'',
            "name": s.name,
            "type": "station",
            "location": {
                "id": s.station_id+'',
                "type": "location",
                "latitude": s.lonlat.y,
                "longitude": s.lonlat.x
            }
        };
    }
    if (evaNrMap[s.details.id]) {
        const e = evaNrMap[s.details.id]
        s.details["ifoptId"] = e.ifoptId;
        if (geoDist(s.details.location.longitude, s.details.location.latitude, e.lon, e.lat) > 500) {
            wrongPositionHafas.push(s.details);
            s.details.location.latitude = e.lat;
            s.details.location.longitude = e.lon;
        }
        e.used = true;
    }
    if (s.lines) {
        s.details["lines"] = s.lines.map(l => ({
            "name": l
        }));
    }
    transformStream.write(s.details);
    i++;
    if (i % 10000 == 0) console.log(i, 'stations done.');
});
Object.keys(evaNrMap).forEach(key => {
    if (!evaNrMap[key].used && evaNrMap[key].lat) {
        const e = evaNrMap[key];
        const details = {
            "id": key+'',
            "name": e.name,
            "type": "station",
            "location": {
                "id": key+'',
                "type": "location",
                "latitude": e.lat,
                "longitude": e.lon
            },
            "ifoptId": e.ifoptId
        };
        transformStream.write(details);
        console.log('Missing HAFAS station: ', details);
    }
})
transformStream.end();

outputStream.on(
	"finish",
	() => console.log('Done.')
);


console.log('wrongPositionHafas:', wrongPositionHafas.length);
fs.writeFileSync('/data/wrongPositionHafas.json', JSON.stringify(wrongPositionHafas));



db.disconnect();