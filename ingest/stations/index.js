import stations from 'db-hafas-stations'
import db from '../db.js'

const formatStation = (s) => {
    return  {
        station_id: parseInt(s.id),
        name: s.name,
        lonlat:  '('+s.location.longitude+','+s.location.latitude+')',
        details: s
    }
}

var i = 0;
stations.full()
.on('data', station => {
    db.upsertStations('db', [formatStation(station)], true);
    i++;
    if (i%1000==0) console.log(i);
})
.on('error', console.error)