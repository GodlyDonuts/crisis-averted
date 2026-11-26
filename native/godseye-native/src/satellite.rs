use crate::data::SatelliteTle;

pub const SATELLITE_CAP: usize = 110;
const WGS84_SEMI_MAJOR_KM: f64 = 6378.137;
const WGS84_FLATTENING: f64 = 1.0 / 298.257223563;

#[derive(Debug)]
pub struct SatellitePropagator {
    pub source_index: usize,
    pub constants: sgp4::Constants,
    pub epoch_unix: f64,
}

#[derive(Debug, Clone, Copy)]
pub struct SatellitePosition {
    pub source_index: usize,
    pub lat: f32,
    pub lng: f32,
    pub altitude_km: f32,
    pub minutes_since_epoch: f64,
}

pub fn build_satellite_propagators(
    satellites: &[SatelliteTle],
) -> (Vec<SatellitePropagator>, Vec<String>) {
    let mut propagators = Vec::new();
    let mut errors = Vec::new();
    for (source_index, satellite) in satellites.iter().take(SATELLITE_CAP).enumerate() {
        match sgp4::Elements::from_tle(
            Some(satellite.name.clone()),
            satellite.line1.as_bytes(),
            satellite.line2.as_bytes(),
        )
        .map_err(|error| format!("TLE parse {:?}", error))
        .and_then(|elements| {
            let constants = sgp4::Constants::from_elements(&elements)
                .map_err(|error| format!("SGP4 init {:?}", error))?;
            let epoch_unix = elements.datetime.and_utc().timestamp_millis() as f64 / 1000.0;
            Ok((constants, epoch_unix))
        }) {
            Ok((constants, epoch_unix)) => propagators.push(SatellitePropagator {
                source_index,
                constants,
                epoch_unix,
            }),
            Err(error) => errors.push(format!("{}: {}", satellite.name, error)),
        }
    }
    (propagators, errors)
}

fn gmst_radians(unix_seconds: f64) -> f64 {
    let julian_date = unix_seconds / 86400.0 + 2440587.5;
    let days_since_j2000 = julian_date - 2451545.0;
    let degrees = (18.697374558 + 24.06570982441908 * days_since_j2000) * 15.0;
    degrees.to_radians()
}

/// Convert a TEME-like inertial vector to an approximate WGS84 Earth-fixed position.
/// This is adequate for operational globe visualization, but omits polar motion, nutation,
/// and frame-bias corrections. The UI labels it as an approximate client-side propagation.
fn teme_to_geodetic(position_km: [f64; 3], unix_seconds: f64) -> Option<(f64, f64, f64)> {
    let theta = gmst_radians(unix_seconds);
    let (sin_theta, cos_theta) = theta.sin_cos();
    let x_inertial = position_km[0];
    let y_inertial = position_km[1];
    let z_inertial = position_km[2];
    let x = x_inertial * cos_theta + y_inertial * sin_theta;
    let y = -x_inertial * sin_theta + y_inertial * cos_theta;
    let z = z_inertial;

    let a = WGS84_SEMI_MAJOR_KM;
    let f = WGS84_FLATTENING;
    let b = a * (1.0 - f);
    let e2 = f * (2.0 - f);
    let ep2 = (a * a - b * b) / (b * b);
    let p = (x * x + y * y).sqrt();
    if !p.is_finite() || p < 1e-9 {
        return None;
    }
    let theta_geodetic = (z * a).atan2(p * b);
    let sin_t = theta_geodetic.sin();
    let cos_t = theta_geodetic.cos();
    let lat = (z + ep2 * b * sin_t.powi(3)).atan2(p - e2 * a * cos_t.powi(3));
    let lng = y.atan2(x);
    let sin_lat = lat.sin();
    let n = a / (1.0 - e2 * sin_lat * sin_lat).sqrt();
    let altitude = p / lat.cos() - n;
    if lat.is_finite() && lng.is_finite() && altitude.is_finite() {
        Some((lat.to_degrees(), lng.to_degrees(), altitude))
    } else {
        None
    }
}

pub fn propagate_satellites(
    propagators: &[SatellitePropagator],
    unix_seconds: f64,
) -> Vec<SatellitePosition> {
    let mut positions = Vec::with_capacity(propagators.len());
    for propagator in propagators {
        let minutes_since_epoch = (unix_seconds - propagator.epoch_unix) / 60.0;
        let Ok(prediction) = propagator
            .constants
            .propagate(sgp4::MinutesSinceEpoch(minutes_since_epoch))
        else {
            continue;
        };
        let Some((lat, lng, altitude_km)) = teme_to_geodetic(prediction.position, unix_seconds)
        else {
            continue;
        };
        if lat.abs() <= 90.0 && lng.abs() <= 180.0 && altitude_km > -100.0 {
            positions.push(SatellitePosition {
                source_index: propagator.source_index,
                lat: lat as f32,
                lng: lng as f32,
                altitude_km: altitude_km as f32,
                minutes_since_epoch,
            });
        }
    }
    positions
}

#[cfg(test)]
mod tests {
    use super::*;

    fn iss_fixture() -> SatelliteTle {
        SatelliteTle {
            id: "25544".to_string(),
            name: "ISS (ZARYA)".to_string(),
            group: "stations".to_string(),
            catalog_number: 25544,
            line1: "1 25544U 98067A   20194.88612269 -.00002218  00000-0 -31515-4 0  9992"
                .to_string(),
            line2: "2 25544  51.6461 221.2784 0001413  89.1723 280.4612 15.49507896236008"
                .to_string(),
            epoch: "20194.88612269".to_string(),
        }
    }

    #[test]
    fn sgp4_propagation_produces_finite_plausible_position() {
        let (propagators, errors) = build_satellite_propagators(&[iss_fixture()]);
        assert!(errors.is_empty(), "{:?}", errors);
        assert_eq!(propagators.len(), 1);
        let positions = propagate_satellites(&propagators, propagators[0].epoch_unix + 3600.0);
        assert_eq!(positions.len(), 1);
        let position = positions[0];
        assert!(
            position.lat.abs() <= 52.0,
            "unexpected ISS latitude {}",
            position.lat
        );
        assert!(position.altitude_km > 300.0 && position.altitude_km < 500.0);
    }

    #[test]
    fn invalid_tle_is_reported_not_fabricated() {
        let mut satellite = iss_fixture();
        satellite.line2 = "not a tle".to_string();
        let (propagators, errors) = build_satellite_propagators(&[satellite]);
        assert!(propagators.is_empty());
        assert_eq!(errors.len(), 1);
    }
}
