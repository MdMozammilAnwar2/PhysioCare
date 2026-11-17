// Sequelize models for the tables Phase 0 code uses. The schema itself lives in migrations.
import { DataTypes } from 'sequelize';
import { sequelize } from '../db/index.js';

const uuidPk = { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 };
const createdOnly = { timestamps: true, updatedAt: false };

export const User = sequelize.define('User', {
  id: uuidPk,
  phone: { type: DataTypes.STRING(16), allowNull: false, unique: true },
  name: DataTypes.STRING(120),
  gender: DataTypes.STRING(16),
  birthYear: DataTypes.SMALLINT,
  email: DataTypes.STRING,
  preferredLanguage: { type: DataTypes.STRING(8), defaultValue: 'en' },
  status: { type: DataTypes.ENUM('active', 'blocked', 'deleted'), defaultValue: 'active' },
  lastLoginAt: DataTypes.DATE,
}, { tableName: 'users' });

export const UserRole = sequelize.define('UserRole', {
  userId: { type: DataTypes.UUID, primaryKey: true },
  role: { type: DataTypes.STRING, primaryKey: true },
  scopeCityId: DataTypes.UUID,
  grantedBy: DataTypes.UUID,
}, { tableName: 'user_roles', ...createdOnly });

export const OtpRequest = sequelize.define('OtpRequest', {
  id: uuidPk,
  phone: { type: DataTypes.STRING(16), allowNull: false },
  codeHash: { type: DataTypes.CHAR(64), allowNull: false },
  purpose: { type: DataTypes.STRING(24), defaultValue: 'login' },
  attempts: { type: DataTypes.SMALLINT, defaultValue: 0 },
  expiresAt: { type: DataTypes.DATE, allowNull: false },
  consumedAt: DataTypes.DATE,
  ip: DataTypes.INET,
}, { tableName: 'otp_requests', ...createdOnly });

export const RefreshToken = sequelize.define('RefreshToken', {
  id: uuidPk,
  userId: { type: DataTypes.UUID, allowNull: false },
  tokenHash: { type: DataTypes.CHAR(64), allowNull: false, unique: true },
  familyId: { type: DataTypes.UUID, allowNull: false },
  expiresAt: { type: DataTypes.DATE, allowNull: false },
  revokedAt: DataTypes.DATE,
  replacedBy: DataTypes.UUID,
  deviceInfo: DataTypes.JSONB,
}, { tableName: 'refresh_tokens', ...createdOnly });

export const Consent = sequelize.define('Consent', {
  id: uuidPk,
  userId: { type: DataTypes.UUID, allowNull: false },
  document: { type: DataTypes.STRING(48), allowNull: false },
  version: { type: DataTypes.STRING(16), allowNull: false },
  accepted: { type: DataTypes.BOOLEAN, allowNull: false },
  method: { type: DataTypes.STRING(16), allowNull: false },
  subjectId: DataTypes.UUID,
  meta: DataTypes.JSONB,
  ip: DataTypes.INET,
}, { tableName: 'consents', ...createdOnly });

export const Block = sequelize.define('Block', {
  id: uuidPk,
  userId: { type: DataTypes.UUID, allowNull: false },
  reasonCode: { type: DataTypes.STRING(48), allowNull: false },
  note: { type: DataTypes.TEXT, allowNull: false },
  endsAt: DataTypes.DATE,
  untilReview: { type: DataTypes.BOOLEAN, defaultValue: false },
  conditions: DataTypes.JSONB,
  blockedBy: { type: DataTypes.UUID, allowNull: false },
  liftedAt: DataTypes.DATE,
  liftedBy: DataTypes.UUID,
  liftNote: DataTypes.TEXT,
}, { tableName: 'blocks', ...createdOnly });

export const TrackedLink = sequelize.define('TrackedLink', {
  id: uuidPk,
  code: { type: DataTypes.STRING, allowNull: false, unique: true },
  type: { type: DataTypes.STRING, allowNull: false },
  ownerUserId: DataTypes.UUID,
  ownerPartnerId: DataTypes.UUID,
  referredByUserId: DataTypes.UUID,
  singleUse: { type: DataTypes.BOOLEAN, defaultValue: false },
  usedAt: DataTypes.DATE,
  expiresAt: DataTypes.DATE,
  active: { type: DataTypes.BOOLEAN, defaultValue: true },
  meta: DataTypes.JSONB,
}, { tableName: 'tracked_links', ...createdOnly });

export const LinkEvent = sequelize.define('LinkEvent', {
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  linkId: DataTypes.UUID,
  code: DataTypes.STRING,
  event: { type: DataTypes.STRING(16), allowNull: false },
  userId: DataTypes.UUID,
  deviceId: DataTypes.STRING(128),
  ip: DataTypes.INET,
  utm: DataTypes.JSONB,
}, { tableName: 'link_events', ...createdOnly });

export const Attribution = sequelize.define('Attribution', {
  userId: { type: DataTypes.UUID, primaryKey: true },
  firstSource: { type: DataTypes.STRING(32), allowNull: false },
  firstLinkId: DataTypes.UUID,
  firstUtm: DataTypes.JSONB,
  creditedUserId: DataTypes.UUID,
  creditedPartnerId: DataTypes.UUID,
  lastSource: DataTypes.STRING(32),
  lastLinkId: DataTypes.UUID,
  lastTouchAt: DataTypes.DATE,
  selfReported: DataTypes.TEXT,
  flagged: { type: DataTypes.BOOLEAN, defaultValue: false },
  flagReason: DataTypes.TEXT,
  lockedAt: DataTypes.DATE,
}, { tableName: 'attributions' });

export const AuditLog = sequelize.define('AuditLog', {
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  actorUserId: DataTypes.UUID,
  actorRole: DataTypes.STRING(24),
  action: { type: DataTypes.STRING(64), allowNull: false },
  targetType: DataTypes.STRING(32),
  targetId: DataTypes.STRING(64),
  before: DataTypes.JSONB,
  after: DataTypes.JSONB,
  ip: DataTypes.INET,
}, { tableName: 'audit_logs', ...createdOnly });

export const AppSetting = sequelize.define('AppSetting', {
  key: { type: DataTypes.STRING(64), primaryKey: true },
  value: { type: DataTypes.JSONB, allowNull: false },
  updatedBy: DataTypes.UUID,
}, { tableName: 'app_settings', timestamps: true, createdAt: false });

User.hasMany(UserRole, { foreignKey: 'userId', as: 'roles' });
UserRole.belongsTo(User, { foreignKey: 'userId' });
User.hasOne(Attribution, { foreignKey: 'userId', as: 'attribution' });

export { sequelize };
