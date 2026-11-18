// Website CMS: the block types a page is built from. The API validates against this,
// the console builds its editing forms from it, and the website renders each type.
// Field kinds: text, textarea, markdown (headings, **bold**, *italic*, [links](/x), lists), url, image, video, number, select, list.

export const PAGE_KINDS = ['page', 'service', 'condition', 'blog', 'legal', 'city'];
export const PAGE_KIND_LABEL = { page: 'Page', service: 'Service', condition: 'Condition', blog: 'Blog post', legal: 'Legal', city: 'City' };

const t = (name, label, extra = {}) => ({ name, label, kind: 'text', max: 200, ...extra });
const ta = (name, label, extra = {}) => ({ name, label, kind: 'textarea', max: 1000, ...extra });
const md = (name, label, extra = {}) => ({ name, label, kind: 'markdown', max: 20000, ...extra });
const url = (name, label) => ({ name, label, kind: 'url', max: 500 });

export const BLOCK_TYPES = {
  hero: {
    label: 'Hero banner', fields: [
      t('badge', 'Small label above the heading', { max: 60 }), t('heading', 'Heading', { required: true, max: 120 }), ta('sub', 'Text under the heading', { max: 300 }),
      t('ctaLabel', 'Main button text', { max: 40 }), url('ctaHref', 'Main button link'), t('secondaryLabel', 'Second button text', { max: 40 }), url('secondaryHref', 'Second button link'),
      { name: 'imageFileId', label: 'Background image (optional)', kind: 'image' },
    ],
  },
  text: { label: 'Text', fields: [t('heading', 'Heading'), md('body', 'Text', { required: true })] },
  image: { label: 'Image', fields: [{ name: 'imageFileId', label: 'Image', kind: 'image', required: true }, t('alt', 'Describe the image (for screen readers)', { required: true }), t('caption', 'Caption')] },
  video: { label: 'Video', fields: [{ name: 'videoFileId', label: 'Uploaded video', kind: 'video' }, url('youtubeUrl', 'Or a YouTube link'), t('caption', 'Caption')] },
  cards: {
    label: 'Cards', fields: [t('heading', 'Heading'), ta('sub', 'Text under the heading', { max: 300 }),
      { name: 'items', label: 'Cards', kind: 'list', max: 12, fields: [t('icon', 'Emoji or icon', { max: 8 }), t('title', 'Title', { required: true, max: 80 }), ta('body', 'Text', { max: 400 }), url('href', 'Link (optional)')] }],
  },
  steps: { label: 'Steps', fields: [t('heading', 'Heading'), { name: 'items', label: 'Steps', kind: 'list', max: 8, fields: [t('title', 'Title', { required: true, max: 80 }), ta('body', 'Text', { max: 400 })] }] },
  stats: { label: 'Numbers', fields: [{ name: 'items', label: 'Numbers', kind: 'list', max: 6, fields: [t('value', 'Number', { required: true, max: 20 }), t('label', 'Label', { required: true, max: 60 })] }] },
  faq: { label: 'Questions & answers', fields: [t('heading', 'Heading'), { name: 'items', label: 'Questions', kind: 'list', max: 40, fields: [t('q', 'Question', { required: true, max: 200 }), md('a', 'Answer', { required: true, max: 3000 })] }] },
  testimonials: { label: 'Testimonials', fields: [t('heading', 'Heading'), { name: 'items', label: 'Testimonials', kind: 'list', max: 12, fields: [ta('quote', 'Quote', { required: true, max: 500 }), t('name', 'Name', { required: true, max: 80 }), t('detail', 'Detail (e.g. Knee replacement, Kankarbagh)', { max: 120 })] }] },
  cta: { label: 'Call to action', fields: [t('heading', 'Heading', { required: true }), ta('sub', 'Text', { max: 300 }), t('label', 'Button text', { required: true, max: 40 }), url('href', 'Button link')] },
  notice: { label: 'Notice box', fields: [{ name: 'tone', label: 'Style', kind: 'select', options: ['info', 'warning'] }, md('body', 'Text', { required: true, max: 2000 })] },
  // Dynamic blocks: filled with live data on the website.
  physios: { label: 'Physiotherapists (live list)', fields: [t('heading', 'Heading'), ta('sub', 'Text', { max: 300 }), { name: 'limit', label: 'How many', kind: 'number', min: 1, max: 24 }] },
  zones: { label: 'Service areas (live from zones)', fields: [t('heading', 'Heading'), ta('sub', 'Text', { max: 300 })] },
  pageList: { label: 'List of pages', fields: [t('heading', 'Heading'), { name: 'kind', label: 'Which pages', kind: 'select', options: ['service', 'condition', 'blog', 'city'], required: true }, { name: 'limit', label: 'How many', kind: 'number', min: 1, max: 50 }] },
  grievance: { label: 'Grievance Officer details (live from settings)', fields: [t('heading', 'Heading')] },
};

/** Checks a page's blocks. Returns an error message or null. */
export function validateBlocks(blocks) {
  if (!Array.isArray(blocks)) return 'Blocks must be a list.';
  if (blocks.length > 60) return 'A page can have up to 60 blocks.';
  if (JSON.stringify(blocks).length > 400_000) return 'This page is too large.';
  const check = (fields, obj, where) => {
    for (const f of fields) {
      const v = obj[f.name];
      if (v === undefined || v === null || v === '') { if (f.required) return `${where}: “${f.label}” is required.`; continue; }
      if (f.kind === 'list') {
        if (!Array.isArray(v)) return `${where}: “${f.label}” must be a list.`;
        if (v.length > (f.max ?? 20)) return `${where}: up to ${f.max} items in “${f.label}”.`;
        for (const [i, item] of v.entries()) { const e = check(f.fields, item ?? {}, `${where}, item ${i + 1}`); if (e) return e; }
      } else if (f.kind === 'number') {
        if (typeof v !== 'number' || v < (f.min ?? 0) || v > (f.max ?? 1e6)) return `${where}: “${f.label}” must be a number${f.max ? ` up to ${f.max}` : ''}.`;
      } else if (f.kind === 'select') {
        if (!f.options.includes(v)) return `${where}: pick a valid “${f.label}”.`;
      } else if (f.kind === 'image' || f.kind === 'video') {
        if (!/^[0-9a-f-]{36}$/i.test(v)) return `${where}: “${f.label}” is not a valid upload.`;
      } else {
        if (typeof v !== 'string') return `${where}: “${f.label}” must be text.`;
        if (v.length > (f.max ?? 1000)) return `${where}: “${f.label}” is too long (max ${f.max}).`;
        if (f.kind === 'url' && !/^(\/[^\s]*|https?:\/\/[^\s]+|tel:\+?\d+|mailto:[^\s]+|#[\w-]*)$/.test(v)) return `${where}: “${f.label}” must start with /, https://, tel: or mailto:.`;
      }
    }
    return null;
  };
  for (const [i, b] of blocks.entries()) {
    const def = BLOCK_TYPES[b?.type];
    if (!def) return `Block ${i + 1}: unknown type.`;
    const e = check(def.fields, b, `Block ${i + 1} (${def.label})`);
    if (e) return e;
  }
  return null;
}
