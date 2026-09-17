/**
 * Service Area Configuration & Geographic Scope for Nestly
 * 
 * Defines active geographic boundary restrictions for launch and development.
 * Current Active Scope: Kopargaon, Maharashtra, India.
 * Built to be expandable to future cities without refactoring core logic.
 */

const SERVICE_AREAS = {
  KOPARGAON: {
    id: 'kopargaon',
    name: 'Kopargaon',
    normalizedNames: ['kopargaon', 'kopergaon', 'kopargaon, maharashtra', 'kopargaon maharashtra'],
    state: 'Maharashtra',
    country: 'India',
    isActive: true,
    // Verified reference landmarks in Kopargaon
    landmarks: {
      sanjivaniCoE: {
        name: 'Sanjivani College of Engineering',
        area: 'Sahajanandnagar / Shingnapur',
        latitude: 19.8973,
        longitude: 74.4789
      },
      kopargaonStation: {
        name: 'Kopargaon Railway Station',
        area: 'Railway Station Road',
        latitude: 19.8824,
        longitude: 74.4849
      }
    },
    // Verified educational institutions in Kopargaon service scope
    verifiedInstitutions: [
      {
        id: 'sanjivani-coe',
        name: 'Sanjivani College of Engineering (SCOE)',
        campus: 'Sahajanandnagar'
      },
      {
        id: 'sanjivani-kbp-polytechnic',
        name: 'Sanjivani K.B.P. Polytechnic',
        campus: 'Sahajanandnagar'
      },
      {
        id: 'sanjivani-pharmacy',
        name: 'Sanjivani Institute of Pharmacy',
        campus: 'Sahajanandnagar'
      },
      {
        id: 'kj-somaiya-kopargaon',
        name: 'K.J. Somaiya College of Arts, Commerce & Science',
        campus: 'Mohanirajnagar'
      },
      {
        id: 'ssgm-college',
        name: 'Shri Sharda Bhavan / SSGM College',
        campus: 'Kopargaon'
      }
    ]
  },
  // Future potential service areas (strictly inactive in current launch)
  PUNE: {
    id: 'pune',
    name: 'Pune',
    normalizedNames: ['pune', 'poona'],
    state: 'Maharashtra',
    country: 'India',
    isActive: false
  },
  NASHIK: {
    id: 'nashik',
    name: 'Nashik',
    normalizedNames: ['nashik', 'nasik'],
    state: 'Maharashtra',
    country: 'India',
    isActive: false
  }
};

/**
 * Returns the currently active service area(s)
 */
function getActiveServiceAreas() {
  return Object.values(SERVICE_AREAS).filter((area) => area.isActive);
}

/**
 * Get primary active service area (Kopargaon)
 */
function getPrimaryServiceArea() {
  const active = getActiveServiceAreas();
  return active[0] || SERVICE_AREAS.KOPARGAON;
}

/**
 * Validates whether a city string belongs to an active service area
 * @param {string} cityName - City name to test
 * @returns {boolean}
 */
function isCityInActiveServiceArea(cityName) {
  if (!cityName || typeof cityName !== 'string') return false;
  const normalized = cityName.trim().toLowerCase();
  
  const activeAreas = getActiveServiceAreas();
  return activeAreas.some((area) =>
    area.normalizedNames.includes(normalized) ||
    normalized.includes(area.name.toLowerCase())
  );
}

/**
 * Normalizes city name to official title-cased active city name (e.g. 'Kopargaon')
 */
function normalizeToActiveCity(cityName) {
  if (!cityName) return getPrimaryServiceArea().name;
  const normalized = cityName.trim().toLowerCase();
  for (const area of getActiveServiceAreas()) {
    if (area.normalizedNames.includes(normalized) || normalized.includes(area.name.toLowerCase())) {
      return area.name;
    }
  }
  return cityName.trim();
}

/**
 * Builds a strict MongoDB filter for active service area
 * Can be merged into any public property query
 */
function getActiveLocationQueryFilter() {
  const activeNames = getActiveServiceAreas().map((a) => a.name);
  const regexList = activeNames.map((name) => new RegExp('^' + name + '$', 'i'));
  
  // Checks either top-level city or nested location.city
  return {
    $or: [
      { city: { $in: regexList } },
      { 'location.city': { $in: regexList } }
    ]
  };
}

module.exports = {
  SERVICE_AREAS,
  getActiveServiceAreas,
  getPrimaryServiceArea,
  isCityInActiveServiceArea,
  normalizeToActiveCity,
  getActiveLocationQueryFilter
};
