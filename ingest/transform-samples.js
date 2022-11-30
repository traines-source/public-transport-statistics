const parseStations = (stopOrStations) => {
    const out = [];
    for (let s of stopOrStations) {
        if (!s) continue;
        const child = {
            station_id: s.id,
            name: s.name,
            lon: s.location.longitude, 
            lat: s.location.latitude
        };
        if (s.station) {
            child.parent = s.station.id; 
            out.push({
                station_id: s.station.id,
                name: s.station.name,
                lon: s.station.location.longitude, 
                lat: s.station.location.latitude,
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

const parseMetadata = (root, trip_id, line, load_factor) => {
    return {
        trip_id: root.tripId || root.id || trip_id,
        remarks: root.remarks,
        cancelled: root.cancelled,
        load_factor: load_factor || root.loadFactor,
        operator: parseOperator((root.line || line).operator),
        ...parseLine(root.line || line)
    }
}

const parseDeparture = (obj) => {
    return {
        scheduled_time: obj.plannedDeparture,
        projected_time: obj.departure,
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
        is_departure: false,
        delay_seconds: obj.arrivalDelay,
        scheduled_platform: obj.plannedArrivalPlatform,
        projected_platform: obj.arrivalPlatform
    }
}

const parseStopovers = (stopovers, destination, provenance, trip_id, line, sample_time, omit_start_end) => {
    //omit_start_end = false;
    if (!stopovers) return [];
    const out = [];
    for (let i=omit_start_end?1:0; i<stopovers.length-(omit_start_end?1:0); i++) {
        let stopover = stopovers[i];
        if (stopover.departure) {
            out.push({
                ...parseMetadata(stopover, trip_id, line, stopover.stop.loadFactor),
                stations: parseStations([stopover.stop]),
                station_id: stopover.stop.id,
                ...parseDeparture(stopover),
                sample_time: sample_time,
                destination_provenance_id: destination?.id,                
            });
        }
        if (stopover.arrival) {
            out.push({
                ...parseMetadata(stopover, trip_id, line, stopover.stop.loadFactor),
                stations: parseStations([stopover.stop]),
                station_id: stopover.stop.id,
                ...parseArrival(stopover),                    
                sample_time: sample_time,
                destination_provenance_id: provenance?.id,
            });
        }
    }
    return out;
}

const parseAlternatives = (alternatives, is_departure, sample_time, fallback_station_id) => {
    if (!alternatives) return [];
    const out = [];
    for (let alt of alternatives) {
        out.push({
            ...parseMetadata(alt, null, null, alt.stop?.loadFactor),
            stations: parseStations([alt.stop, alt.destination, alt.origin]),
            station_id: alt.stop?.id || fallback_station_id,
            scheduled_time: alt.plannedWhen,
            projected_time: alt.when,
            is_departure: is_departure,
            delay_seconds: alt.delay,
            sample_time: sample_time,
            destination_provenance_id: (is_departure ? alt.destination : alt.origin)?.id,
            scheduled_platform: alt.plannedPlatform,
            projected_platform: alt.platform
        });
        out.push(...parseStopovers(alt.previousStopovers, alt.origin, alt.destination, alt.tripId, alt.line, sample_time, false));
        out.push(...parseStopovers(alt.nextStopovers, alt.origin, alt.destination, alt.tripId, alt.line, sample_time, false));    
    }
    return out;
}

const parseTrip = (trip, sample_time) => {
    const out = [
        {
            ...parseMetadata(trip, null, null, trip.origin.loadFactor),
            stations: parseStations([trip.origin]),
            station_id: trip.origin.id,
            ...parseDeparture(trip),
            sample_time: sample_time,
            destination_provenance_id: trip.destination,                
        },
        {
            ...parseMetadata(trip, null, null, trip.destination.loadFactor),
            stations: parseStations([trip.destination]),
            station_id: trip.destination.id,
            ...parseArrival(trip),                    
            sample_time: sample_time,
            destination_provenance_id: trip.origin,
        }
    ];
    out.push(...parseStopovers(trip.stopovers, trip.origin, trip.destination, trip.id, trip.line, sample_time, true));
    out.push(...parseAlternatives(trip.alternatives, true, sample_time, trip.origin.id));
    return out;    
}

const parseJourneys = (journeys, sample_time) => {
    return journeys.map(journey => journey.legs.map(leg => {
        if (leg.walking) return [];
        const out = [
            {
                ...parseMetadata(leg, null, null, leg.origin.loadFactor),
                stations: parseStations([leg.origin]),
                station_id: leg.origin.id,
                ...parseDeparture(leg),
                sample_time: sample_time,
                destination_provenance_id: null,                
            },
            {
                ...parseMetadata(leg, null, null, leg.origin.loadFactor),
                stations: parseStations([leg.destination]),
                station_id: leg.destination.id,
                ...parseArrival(leg),                    
                sample_time: sample_time,
                destination_provenance_id: null,
            }
        ];
        out.push(...parseStopovers(leg.stopovers, null, null, leg.tripId, leg.line, sample_time, true));
        out.push(...parseAlternatives(leg.alternatives, true, sample_time, leg.origin.id));
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
    'refreshJourney': (journey) => parseJourneys([journey.journey], parseRt(journey))
}

export {
    transformSamples
}