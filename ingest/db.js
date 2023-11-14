import pg from 'pg'
import { from as copyFrom } from 'pg-copy-streams'
import { Readable } from 'stream';
import { pipeline } from 'node:stream/promises'

import {conf} from './read-conf.js'

const pgc = new pg.Client({
    host: conf.host,
    port: conf.port,
    user: conf.user,
    password: conf.password,
});
pgc.connect();


const getLastInserted = async (schema) => {
    const lastInserted = await pgc.query('SELECT MAX(response_time) AS response_time FROM '+schema+'.response_log');
    return lastInserted.rows[0].response_time;
}

const getOperatorMap = (schema) => {
    return getKvMap(schema, 'operator', 'id', 'operator_id');   
}

const getProductTypeMap = (schema) => {
    return getKvMap(schema, 'product_type', 'name', 'product_type_id');   
}

const getLoadFactorMap = (schema) => {
    return getKvMap(schema, 'load_factor', 'name', 'load_factor_id');   
}

const getPrognosisTypeMap = (schema) => {
    return getKvMap(schema, 'prognosis_type', 'name', 'prognosis_type_id');   
}

const insertOperators = async (schema, o) => {
    const fmt = insertFormat(['id', 'name'], o);
    const operators = await pgc.query('INSERT INTO '+schema+'.operator ('+fmt.cols+') VALUES '+fmt.format+' RETURNING operator_id, id', fmt.values);
    return toKvMap(operators.rows, 'id', 'operator_id');    
}

const insertProductTypes = (schema, values) => {
    return insertSingleColWithAutoincrement(schema, 'product_type', 'product_type_id', 'name', values);
}

const insertLoadFactors = (schema, values) => {
    return insertSingleColWithAutoincrement(schema, 'load_factor', 'load_factor_id', 'name', values);
}

const insertPrognosisTypes = (schema, values) => {
    return insertSingleColWithAutoincrement(schema, 'prognosis_type', 'prognosis_type_id', 'name', values);
}

const insertSingleColWithAutoincrement = async (schema, table, pk_col, map_key_col, values) => {
    const fmt = insertFormat([map_key_col], values);
    const result = await pgc.query('INSERT INTO '+schema+'.'+table+' ('+fmt.cols+') VALUES '+fmt.format+' RETURNING '+pk_col+','+map_key_col, values);
    return toKvMap(result.rows, map_key_col, pk_col);    
}

const getStationDetails = async (schema) => {
    const kv = await pgc.query('SELECT s.station_id, lonlat, name, details, lines FROM '+schema+'.station s LEFT JOIN (SELECT station_id, array_agg(DISTINCT line_name) AS lines FROM '+schema+'.sample GROUP BY station_id) l ON l.station_id = s.station_id');
    return kv.rows;   
}

const getKvMap = async (schema, table, key, value) => {
    const kv = await pgc.query('SELECT '+key+', '+value+' FROM '+schema+'.'+table);
    return toKvMap(kv.rows, key, value);    
}

const upsertStations = async (schema, o, detailsOnlyIfNull) => {
    const fmt = insertFormatArray(
        {'station_id':'text', 'lonlat':'point', 'name':'text', 'parent':'text', 'details':'jsonb'},
        o
    );
    await pgc.query(
        'INSERT INTO '+schema+'.station AS s ('+fmt.cols+') SELECT * FROM UNNEST '+fmt.format
        +' ON CONFLICT (station_id) DO UPDATE SET details = EXCLUDED.details' + (detailsOnlyIfNull ? ' WHERE s.details IS NULL' : '')
        , fmt.values);   
}

const upsertOperators = async (schema, o) => {
    const fmt = insertFormat(['operator_id', 'id', 'name'], o);
    await pgc.query('INSERT INTO '+schema+'.operator ('+fmt.cols+') VALUES '+fmt.format+' ON CONFLICT (operator_id) DO NOTHING', fmt.values);
}

const upsertRemarks = async (schema, o) => {
    const fmt = insertFormat(['remarks_hash', 'remarks'], o);
    await pgc.query('INSERT INTO '+schema+'.remarks ('+fmt.cols+') VALUES '+fmt.format+' ON CONFLICT (remarks_hash) DO NOTHING', fmt.values);   
}

const insertResponse = async (schema, response) => {
    const fmt = insertFormat(['hash', 'type', 'response_time', 'response_time_estimated', 'sample_time_estimated', 'source', 'sample_count', 'ctrs'], [response]);
    const r = await pgc.query('INSERT INTO '+schema+'.response_log ('+fmt.cols+') VALUES '+fmt.format+' RETURNING response_id', fmt.values);
    return r.rows[0].response_id;
}

const nullable = (obj) => {
    if (obj == undefined || obj == null) return '';
    return obj;
}

const nullableTime = (obj) => {
    if (obj == undefined || obj == null) return '';
    return obj.toISOString();
}

const sampleToTSV = (s) => {
    return nullableTime(s.scheduled_time)
    +'\t'+nullable(s.scheduled_duration_minutes)
    +'\t'+nullable(s.projected_duration_minutes)
    +'\t'+nullable(s.delay_minutes)
    +'\t'+s.cancelled
    +'\t'+nullableTime(s.sample_time)
    +'\t'+s.ttl_minutes
    +'\t'+s.trip_id
    +'\t'+nullable(s.line_name)
    +'\t'+nullable(s.line_fahrtnr)
    +'\t'+nullable(s.product_type_id)
    +'\t'+nullable(s.product_name)
    +'\t'+s.station_id
    +'\t'+nullable(s.operator_id)
    +'\t'+s.is_departure
    +'\t'+nullable(s.remarks_hash)
    +'\t'+nullable(s.stop_number)
    +'\t'+nullable(s.load_factor_id)
    +'\t'+nullable(s.response_id)
    +'\t'+nullable(s.prognosis_type_id)
    +'\n';
}

const fakeStreamToTSV = (samples) => {
    let i = 0;
    let len = samples.length;
    return new Readable({ 
        read() {
            let stop = false;
            while (i < len && !stop) {
                stop = this.push(sampleToTSV(samples[i]));
                i++;
            }
            if (i >= len) this.push(null);
        },
        objectMode: false
    });
}

const sampleCols = {'scheduled_time':'timestamptz', 'scheduled_duration_minutes':'smallint', 'projected_duration_minutes':'smallint', 'delay_minutes':'smallint', 'cancelled':'boolean', 'sample_time':'timestamptz', 'ttl_minutes':'smallint', 'trip_id':'text', 'line_name':'text', 'line_fahrtnr':'text', 'product_type_id':'smallint', 'product_name':'text', 'station_id':'text', 'operator_id':'smallint', 'is_departure':'boolean', 'remarks_hash':'uuid', 'stop_number':'smallint', 'load_factor_id':'smallint', 'response_id':'int', 'prognosis_type_id':'smallint'};

const streamInsertSamples = (schema) => {
    return pgc.query(copyFrom('COPY '+schema+'.sample ('+Object.keys(sampleCols).join(',')+') FROM STDIN WITH (NULL \'\')'));
}

const insertSamples = async (schema, samples) => {
    const ingestStream = streamInsertSamples(schema);
    const sourceStream = fakeStreamToTSV(samples);
    await pipeline(sourceStream, ingestStream);
}

const unnestInsertSamples = async (schema, samples) => {
    console.log('preparing samples');
    const fmt = insertFormatArray(sampleCols, samples);
    console.log('sending query');
    await pgc.query('INSERT INTO '+schema+'.sample ('+fmt.cols+') SELECT * FROM UNNEST '+fmt.format, fmt.values);
    console.log('query sent');
}

const updateMaterializedHistograms = async (schema) => {
    await pgc.query('CALL '+schema+'.refresh_histograms_and_cleanup_samples()');   
}

const insertFormatArray = (columns, array) => {
    const keys = Object.keys(columns);
    const cols = keys.join(', ');
    const format = valuesFormat(1, keys.length, keys.map(k => columns[k]));
    const values = keys.map(col => array.map(row => row[col]));
    return {cols, format, values};
}

const insertFormat = (columns, array) => {
    const cols = columns.join(', ');
    const format = valuesFormat(array.length, columns.length);
    const values = array.map(row => columns.map(col => row[col])).flat();
    return {cols, format, values};
}

const valuesFormat = (rowNum, colNum, types) => {
    let i = 1;
    return Array(rowNum).fill(0).map(v => '('+Array(colNum).fill(0).map((v, coli) => '$'+(i++)+(types ? '::'+types[coli]+'[]' : '')).join(', ')+')').join(', ')
}

const toKvMap = (rows, key, value) => {
    const map = {};
    for (let i=0; i<rows.length;i++) {
        map[rows[i][key]] = rows[i][value]
    }
    return map;
}

const begin = () => {
    return pgc.query('BEGIN');
}

const commit = () => {
    return pgc.query('COMMIT');
}

const rollback = () => {
    return pgc.query('ROLLBACK');
}

const disconnect = () => {
    pgc
  .end()
  .catch((err) => console.error('error during disconnection', err.stack));
}

export default {
    getOperatorMap,
    getProductTypeMap,
    getLoadFactorMap,
    getPrognosisTypeMap,
    getStationDetails,
    insertOperators,
    insertProductTypes,
    insertLoadFactors,
    insertPrognosisTypes,
    upsertStations,
    upsertOperators,
    upsertRemarks,
    insertResponse,
    sampleToTSV,
    streamInsertSamples,
    insertSamples,
    updateMaterializedHistograms,
    begin,
    commit,
    rollback,
    disconnect,
}