/**
 * The shared vocabulary of the product, served by GET /api/reference and also
 * bundled into the guard app as an offline fallback.
 *
 * The server is authoritative: it validates every incoming violation against
 * these ids. The phone bundles the same file so a guard whose phone has never
 * been online since an update still sees a complete list — a violation type
 * the server does not know is rejected at sync and shown to the guard as
 * "Failed", never silently dropped.
 *
 * GENERAL CITY ENFORCEMENT. From the requirement call: a guard on patrol in
 * the city sees a car parked where it should not be, takes a photo, and the
 * record (plate, place, GPS, date and time) is stored on the phone until it
 * can be sent. The list covers what a guard can see standing next to a
 * vehicle — not offences that need a speed gun or a camera network.
 *
 * AREAS. Abu Dhabi districts, with approximate centre points used only to seed
 * demo data and to centre the dashboard map. A guard's real position comes
 * from the phone's GPS; the area is the human-readable place that still works
 * in an underground car park where there is no GPS signal.
 */

/*
 * FINES. `code` and `fine` (AED) are printed on the penalty notice the guard
 * hands over. SAMPLE VALUES for the POC — the authority's own fee schedule
 * replaces them. `fine: null` = amount assessed later by the authority.
 */
export const VIOLATION_TYPES = [
  { id: 'no-parking', label: 'No-parking zone', short: 'No parking', severity: 'medium', icon: 'ban', code: 'P-101', fine: 200 },
  { id: 'double-parking', label: 'Double parking', short: 'Double parked', severity: 'medium', icon: 'copy', code: 'P-102', fine: 500 },
  { id: 'disabled-bay', label: 'People of Determination bay, no permit', short: 'PoD bay', severity: 'high', icon: 'accessibility', code: 'P-103', fine: 1000 },
  { id: 'fire-lane', label: 'Fire lane or hydrant blocked', short: 'Fire lane', severity: 'high', icon: 'flame', code: 'P-104', fine: 1000 },
  { id: 'blocking', label: 'Blocking a driveway, gate or vehicle', short: 'Blocking', severity: 'medium', icon: 'octagon', code: 'P-105', fine: 500 },
  { id: 'footpath', label: 'On footpath or pedestrian crossing', short: 'Footpath', severity: 'medium', icon: 'footprints', code: 'P-106', fine: 400 },
  { id: 'bus-stop', label: 'At a bus stop or taxi stand', short: 'Bus stop', severity: 'medium', icon: 'bus', code: 'P-107', fine: 500 },
  { id: 'unpaid', label: 'Parking fee unpaid or ticket expired', short: 'Unpaid', severity: 'low', icon: 'receipt', code: 'P-108', fine: 200 },
  { id: 'outside-bay', label: 'Across two bays or outside markings', short: 'Outside bay', severity: 'low', icon: 'square-dashed', code: 'P-109', fine: 200 },
  { id: 'loading-zone', label: 'Misusing a loading zone', short: 'Loading zone', severity: 'low', icon: 'truck', code: 'P-110', fine: 300 },
  { id: 'wrong-way', label: 'Wrong way or against traffic flow', short: 'Wrong way', severity: 'high', icon: 'arrow-left-right', code: 'P-111', fine: 600 },
  { id: 'abandoned', label: 'Abandoned or neglected vehicle', short: 'Abandoned', severity: 'low', icon: 'car', code: 'P-112', fine: 1000 },
  { id: 'other', label: 'Other (describe in notes)', short: 'Other', severity: 'medium', icon: 'more', code: 'P-199', fine: null },
];

export const SEVERITIES = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
];

export const EMIRATES = [
  { id: 'AD', label: 'Abu Dhabi' },
  { id: 'DXB', label: 'Dubai' },
  { id: 'SHJ', label: 'Sharjah' },
  { id: 'AJM', label: 'Ajman' },
  { id: 'UAQ', label: 'Umm Al Quwain' },
  { id: 'RAK', label: 'Ras Al Khaimah' },
  { id: 'FUJ', label: 'Fujairah' },
  { id: 'OTH', label: 'Other / GCC' },
];

export const AREAS = [
  { id: 'markaziyah', label: 'Al Markaziyah (Downtown)', lat: 24.4889, lng: 54.3602 },
  { id: 'khalidiyah', label: 'Al Khalidiyah', lat: 24.4718, lng: 54.3489 },
  { id: 'bateen', label: 'Al Bateen', lat: 24.4593, lng: 54.3338 },
  { id: 'zahiyah', label: 'Al Zahiyah (Tourist Club)', lat: 24.4951, lng: 54.3775 },
  { id: 'reem', label: 'Al Reem Island', lat: 24.4992, lng: 54.4041 },
  { id: 'maryah', label: 'Al Maryah Island', lat: 24.5011, lng: 54.3893 },
  { id: 'corniche', label: 'Corniche', lat: 24.4801, lng: 54.3441 },
  { id: 'mushrif', label: 'Al Mushrif', lat: 24.4402, lng: 54.3885 },
  { id: 'nahyan', label: 'Al Nahyan', lat: 24.4582, lng: 54.3836 },
  { id: 'khalifa-city', label: 'Khalifa City', lat: 24.4192, lng: 54.5781 },
  { id: 'mbz-city', label: 'Mohammed Bin Zayed City', lat: 24.3391, lng: 54.5392 },
  { id: 'raha', label: 'Al Raha Beach', lat: 24.4502, lng: 54.6003 },
  { id: 'yas', label: 'Yas Island', lat: 24.4893, lng: 54.6082 },
  { id: 'saadiyat', label: 'Saadiyat Island', lat: 24.5421, lng: 54.4342 },
  { id: 'mussafah', label: 'Mussafah', lat: 24.3482, lng: 54.4973 },
];

/** Centre of the dashboard map when there are no records yet. */
export const CITY = { name: 'Abu Dhabi', lat: 24.4539, lng: 54.3773, zoom: 11 };

export const STATUSES = [
  { id: 'new', label: 'New' },
  { id: 'reviewed', label: 'Reviewed' },
  { id: 'actioned', label: 'Fine issued' },
  { id: 'dismissed', label: 'Dismissed' },
];

export const typeById = (id) => VIOLATION_TYPES.find((t) => t.id === id);
export const areaById = (id) => AREAS.find((a) => a.id === id);
export const emirateById = (id) => EMIRATES.find((e) => e.id === id);
