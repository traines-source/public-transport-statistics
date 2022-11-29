import {createRequire} from 'module'
const require = createRequire(import.meta.url)

const conf = require('./ingest.conf.json')

export {
    conf
}