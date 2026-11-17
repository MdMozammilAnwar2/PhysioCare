// Constants shared by the API, web apps and mobile apps.
export const APP_VERSION = '0.2.1';

// Roles. SUPER_ADMIN can only be created from the server environment (see apps/api/scripts/seed.js).
export const ROLES = Object.freeze({
  PATIENT: 'patient',
  THERAPIST: 'therapist',
  PARTNER_OWNER: 'partner_owner',
  PARTNER_STAFF: 'partner_staff',
  PARTNER_WALLET: 'partner_wallet',
  OPS_ADMIN: 'ops_admin',
  FINANCE: 'finance',
  CITY_COORDINATOR: 'city_coordinator',
  SUPER_ADMIN: 'super_admin',
});
export const ADMIN_ROLES = [ROLES.OPS_ADMIN, ROLES.FINANCE, ROLES.CITY_COORDINATOR, ROLES.SUPER_ADMIN];
// Roles a person may pick for themselves at sign-up.
export const SELF_SERVE_ROLES = [ROLES.PATIENT, ROLES.THERAPIST, ROLES.PARTNER_OWNER];

export const ZONE_STATUS = Object.freeze({ GREEN: 'green', BLUE: 'blue', YELLOW: 'yellow', ORANGE: 'orange', RED: 'red' });

export const ATTRIBUTION_SOURCES = Object.freeze({
  HOSPITAL_QR: 'hospital_qr',
  PARTNER_PERMANENT_QR: 'partner_permanent_qr',
  FRIEND_LINK: 'friend_link',
  PHYSIO_LINK: 'physio_link',
  CAMPAIGN: 'campaign',
  ORGANIC: 'organic',
  SELF_REPORTED: 'self_reported',
});

export const VISIT_STATUS = Object.freeze({
  HELD: 'held', BOOKED: 'booked', ON_THE_WAY: 'on_the_way', CHECKED_IN: 'checked_in',
  COMPLETED: 'completed', CANCELLED: 'cancelled', LATE_CANCELLED: 'late_cancelled', NO_SHOW: 'no_show',
});
