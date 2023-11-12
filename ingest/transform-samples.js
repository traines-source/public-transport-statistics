const parseStations = (stopOrStations) => {
    const out = [];
    for (let s of stopOrStations) {
        if (!s) continue;
        const child = {
            station_id: s.id,
            name: s.name,
            lon: s.location.longitude, 
            lat: s.location.latitude,
            details: s
        };
        if (s.station) {
            child.parent = s.station.id; 
            out.push({
                station_id: s.station.id,
                name: s.station.name,
                lon: s.station.location.longitude, 
                lat: s.station.location.latitude,
                details: s.station
            });
        }
        out.push(child);
    }
    return out;
}

const parseOperator = (operator) => {
    if (!operator) return null;
    return {
        id: operator.id,
        name: operator.name
    }
}

const parseLine = (line) => {
    return {
        line_name: line.name,
        line_fahrtnr: line.fahrtNr,
        line_id: line.id,
        product_type: line.product,
        product_name: line.productName
    }
}

const parseMetadata = (obj, parent_metadata, load_factor, projected) => {
    const data = parent_metadata ? {
        ...parent_metadata
    } : {};
    if (obj.id) data.trip_id = obj.id;
    if (obj.tripId) data.trip_id = obj.tripId;
    if (obj.remarks) data.remarks = obj.remarks;
    data.cancelled = obj.cancelled && !projected;
    data.load_factor = obj.loadFactor;
    if (load_factor) data.load_factor = load_factor;
    if (obj.line) data.operator = parseOperator(obj.line.operator);
    if (obj.line) {
        return {
            ...data,
            ...parseLine(obj.line)
        }
    }
    return data;
}

const parseDeparture = (obj) => {
    return {
        scheduled_time: obj.plannedDeparture,
        projected_time: obj.departure,
        prognosis_type: obj.departurePrognosisType,
        is_departure: true,
        delay_seconds: obj.departureDelay,
        scheduled_platform: obj.plannedDeparturePlatform,
        projected_platform: obj.departurePlatform
    }
}

const parseArrival = (obj) => {
    return {
        scheduled_time: obj.plannedArrival,
        projected_time: obj.arrival,
        prognosis_type: obj.arrivalPrognosisType,
        is_departure: false,
        delay_seconds: obj.arrivalDelay,
        scheduled_platform: obj.plannedArrivalPlatform,
        projected_platform: obj.arrivalPlatform
    }
}

const parseStopovers = (stopovers, destination, provenance, parent_metadata, sample_time) => {
    if (!stopovers) return [];
    const out = [];
    for (let i=0; i<stopovers.length; i++) {
        let stopover = stopovers[i];
        if (stopover.plannedDeparture) {
            out.push({
                ...parseMetadata(stopover, parent_metadata, stopover.stop.loadFactor),
                stations: parseStations([stopover.stop, destination]),
                station_id: stopover.stop.id,
                ...parseDeparture(stopover),
                sample_time: sample_time,
                destination_provenance_id: destination?.id,                
            });
        }
        if (stopover.plannedArrival) {
            out.push({
                ...parseMetadata(stopover, parent_metadata, stopover.stop.loadFactor),
                stations: parseStations([stopover.stop, provenance]),
                station_id: stopover.stop.id,
                ...parseArrival(stopover),                    
                sample_time: sample_time,
                destination_provenance_id: provenance?.id,
            });
        }
    }
    return out;
}

const parseAlternatives = (alternatives, is_departure, sample_time, fallback_station) => {
    if (!alternatives) return [];
    const out = [];
    for (let alt of alternatives) {
        const parent_metadata = parseMetadata(alt, null, alt.stop?.loadFactor);
        out.push({            
            ...parent_metadata,
            stations: parseStations([alt.stop, alt.destination, alt.origin, fallback_station]),
            station_id: alt.stop?.id || fallback_station?.id,
            scheduled_time: alt.plannedWhen,
            projected_time: alt.when,
            prognosis_type: alt.prognosisType,
            is_departure: is_departure,
            delay_seconds: alt.delay,
            sample_time: sample_time,
            destination_provenance_id: (is_departure ? alt.destination : alt.origin)?.id,
            scheduled_platform: alt.plannedPlatform,
            projected_platform: alt.platform
        });
        out.push(...parseStopovers(alt.previousStopovers, alt.origin, alt.destination, parent_metadata, sample_time));
        out.push(...parseStopovers(alt.nextStopovers, alt.origin, alt.destination, parent_metadata, sample_time));    
    }
    return out;
}

const parseTrip = (trip, sample_time) => {
    const parent_metadata = parseMetadata(trip, null, trip.origin.loadFactor, trip.departure);
    const out = [];
    
    out.push(
        {
            ...parent_metadata,
            stations: parseStations([trip.origin]),
            station_id: trip.origin.id,
            ...parseDeparture(trip),
            sample_time: sample_time,
            destination_provenance_id: trip.destination?.id,                
        },
        {
            ...parseMetadata(trip, null, trip.destination.loadFactor, trip.arrival),
            stations: parseStations([trip.destination]),
            station_id: trip.destination.id,
            ...parseArrival(trip),                    
            sample_time: sample_time,
            destination_provenance_id: trip.origin?.id,
        }
    );
    if (trip.stopovers?.length) {
        out.push(...parseStopovers(trip.stopovers, trip.origin, trip.destination, parent_metadata, sample_time));
    }
    out.push(...parseAlternatives(trip.alternatives, true, sample_time, trip.origin));
    return out;    
}

const parseJourneys = (journeys, sample_time) => {
    return journeys.map(journey => journey.legs.map(leg => {
        if (leg.walking) return [];
        const parent_metadata = parseMetadata(leg, null, leg.origin.loadFactor, leg.departure);
        const out = [
            {
                ...parent_metadata,
                stations: parseStations([leg.origin]),
                station_id: leg.origin.id,
                ...parseDeparture(leg),
                sample_time: sample_time,
                destination_provenance_id: null,                
            },
            {
                ...parseMetadata(leg, null, leg.destination.loadFactor, leg.arrival),
                stations: parseStations([leg.destination]),
                station_id: leg.destination.id,
                ...parseArrival(leg),                    
                sample_time: sample_time,
                destination_provenance_id: null,
            }
        ];
        out.push(...parseStopovers(leg.stopovers, null, null, parent_metadata, sample_time));
        out.push(...parseAlternatives(leg.alternatives, true, sample_time, leg.origin));
        return out;
    }).flat()).flat();
}

const parseRt = (obj) => {
    return obj.realtimeDataUpdatedAt || obj.realtimeDataFrom;
}

const transformSamples = {
    'journeys': (journeys) => parseJourneys(journeys.journeys, parseRt(journeys)),
    'departures': (departures) => parseAlternatives(Array.isArray(departures) ? departures : departures.departures, true, parseRt(departures)),
    'arrivals': (arrivals) => parseAlternatives(Array.isArray(arrivals) ? arrivals : arrivals.arrivals, false, parseRt(arrivals)),
    'trip': (trip) => parseTrip(trip.trip, parseRt(trip)),
    'refreshJourney': (journey) => parseJourneys([journey.journey], parseRt(journey)),
    'gtfsrtTripUpdate': (gtfsrt) => gtfsrt
}

export {
    transformSamples
}