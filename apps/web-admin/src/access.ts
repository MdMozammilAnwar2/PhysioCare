// Who sees what in the console: one list drives the left-hand menu, the page guards and dashboard links.
// The API checks every role again on its side; this only keeps people out of pages they can't use.
export const ROLE_LABEL: Record<string, string> = {
  super_admin: 'Super admin', ops_admin: 'Ops admin', finance: 'Finance', city_coordinator: 'City coordinator',
  grievance_committee: 'Grievance committee', content_editor: 'Content editor',
};
// Order used when someone has several roles: the first one decides their dashboard.
export const ROLE_ORDER = ['super_admin', 'ops_admin', 'finance', 'city_coordinator', 'grievance_committee', 'content_editor'];

const ALL = ['super_admin', 'ops_admin', 'finance', 'city_coordinator', 'grievance_committee', 'content_editor'];
const OPS = ['super_admin', 'ops_admin'];
const FIELD = ['super_admin', 'ops_admin', 'city_coordinator'];
const MONEY = ['super_admin', 'finance'];

export type NavItem = { path: string; label: string; roles: string[]; icon: string };
export const SECTIONS: { title: string; items: NavItem[] }[] = [
  { title: 'Overview', items: [
    { path: '/dashboard', label: 'Dashboard', roles: ALL, icon: '◧' },
    { path: '/calendar', label: 'Calendar', roles: [...FIELD, 'finance'], icon: '▦' },
  ] },
  { title: 'Operations', items: [
    { path: '/live', label: 'Live visits & SOS', roles: FIELD, icon: '◉' },
    { path: '/verification', label: 'Physio verification', roles: FIELD, icon: '✓' },
    { path: '/incidents', label: 'Incidents', roles: OPS, icon: '⚑' },
    { path: '/messages', label: 'Messages', roles: OPS, icon: '✉' },
  ] },
  { title: 'Money', items: [
    { path: '/payments', label: 'Payments to confirm', roles: [...OPS, 'finance'], icon: '₹' },
    { path: '/refunds', label: 'Refunds', roles: [...OPS, 'finance'], icon: '↺' },
    { path: '/payouts', label: 'Physio payouts', roles: MONEY, icon: '⇢' },
    { path: '/tds', label: 'TDS report', roles: MONEY, icon: '%' },
    { path: '/money-rules', label: 'Fees, TDS & holds', roles: MONEY, icon: '⚙' },
  ] },
  { title: 'Growth', items: [
    { path: '/partners', label: 'Partners', roles: [...FIELD, 'finance'], icon: '⚇' },
    { path: '/growth', label: 'Where patients come from', roles: [...FIELD, 'finance'], icon: '↗' },
    { path: '/growth-rules', label: 'Coins & rewards', roles: [...OPS, 'finance'], icon: '◎' },
  ] },
  { title: 'Trust & safety', items: [
    { path: '/grievances', label: 'Grievances', roles: [...OPS, 'grievance_committee'], icon: '⚖' },
    { path: '/users', label: 'Users', roles: [...FIELD, 'finance', 'grievance_committee'], icon: '☺' },
    { path: '/blocks', label: 'Blocked accounts', roles: FIELD, icon: '⊘' },
  ] },
  { title: 'Service area', items: [
    { path: '/zones', label: 'Zones', roles: FIELD, icon: '⬡' },
  ] },
  { title: 'Website', items: [
    { path: '/website/pages', label: 'Pages', roles: [...OPS, 'content_editor'], icon: '▤' },
    { path: '/website/settings', label: 'Site settings', roles: [...OPS, 'content_editor'], icon: '⚙' },
  ] },
  { title: 'Super admin', items: [
    { path: '/staff', label: 'Staff & roles', roles: ['super_admin'], icon: '♔' },
    { path: '/settings', label: 'Platform settings', roles: ['super_admin'], icon: '⚙' },
    { path: '/audit', label: 'Audit log', roles: ['super_admin'], icon: '☰' },
  ] },
];
const ITEMS = SECTIONS.flatMap(s => s.items);

/** Can someone with these roles open this path (detail pages follow their list page)? */
export function canOpen(roles: string[], path: string) {
  const item = [...ITEMS].sort((a, b) => b.path.length - a.path.length).find(i => path === i.path || path.startsWith(`${i.path}/`));
  return item ? roles.some(r => item.roles.includes(r)) : false;
}
export const menuFor = (roles: string[]) => SECTIONS.map(s => ({ ...s, items: s.items.filter(i => roles.some(r => i.roles.includes(r))) })).filter(s => s.items.length);
export const mainRole = (roles: string[]) => ROLE_ORDER.find(r => roles.includes(r)) ?? roles[0];
export const labelFor = (path: string) => ITEMS.find(i => path === i.path || path.startsWith(`${i.path}/`))?.label;
