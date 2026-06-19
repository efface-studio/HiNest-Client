/**
 * 좌표 ↔ 지오펜스(원형 반경) 매칭 유틸 — 회사 출근 위치 자동출근 검사용.
 *
 * 의존성 없이 위경도 거리(Haversine)만 계산. 단일 IP 가 "/32" 로 정규화되듯, 여기선
 * 각 사무실을 (중심좌표, 반경m) 원으로 표현하고 OR 매칭(하나라도 반경 안이면 통과).
 * 클라가 보낸 lat/lng(GPS)와 회사 등록 좌표를 비교 — IP 처럼 위·변조 가능성은 있으나
 * 모바일 OS 위치 권한 기반이라 사무실 출근 편의 용도로는 충분.
 */

const EARTH_RADIUS_M = 6_371_000; // 지구 평균 반지름(m)

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** 두 좌표 사이 대원 거리(미터). Haversine. */
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

/** lat/lng 가 유효한 좌표 범위인가. (lat -90~90, lng -180~180, 유한 숫자) */
export function isValidLatLng(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

/** 반경(m) 검증 — 20m ~ 5000m. 너무 작으면 GPS 오차로 출근 불가, 너무 크면 무의미. */
export function isValidRadius(m: number): boolean {
  return Number.isInteger(m) && m >= 20 && m <= 5000;
}

/** lat/lng 가 fences 중 하나라도 반경 안이면 true. fences 가 비어있으면 false(통과 안 함). */
export function withinAnyGeofence(
  lat: number,
  lng: number,
  fences: { lat: number; lng: number; radiusM: number }[],
): boolean {
  if (!fences.length) return false;
  if (!isValidLatLng(lat, lng)) return false;
  for (const f of fences) {
    if (haversineMeters(lat, lng, f.lat, f.lng) <= f.radiusM) return true;
  }
  return false;
}
