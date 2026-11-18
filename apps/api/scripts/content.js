// Starter website content, written by `npm run api:seed` only for pages that don't exist yet.
// Edit everything afterwards in the console (Website › Pages). Legal pages are DRAFTS: have a lawyer review them.
let n = 0;
const id = () => `b${++n}`;
const hero = (heading, sub, extra = {}) => ({ id: id(), type: 'hero', heading, sub, ...extra });
const text = (body, heading) => ({ id: id(), type: 'text', ...(heading ? { heading } : {}), body });
const cards = (heading, items, sub) => ({ id: id(), type: 'cards', heading, ...(sub ? { sub } : {}), items });
const faq = (heading, items) => ({ id: id(), type: 'faq', heading, items: items.map(([q, a]) => ({ q, a })) });
const cta = (heading, sub, label = 'Find a physiotherapist', href = '/book') => ({ id: id(), type: 'cta', heading, sub, label, href });
const steps = (heading, items) => ({ id: id(), type: 'steps', heading, items: items.map(([title, body]) => ({ title, body })) });
const notice = (body, tone = 'warning') => ({ id: id(), type: 'notice', tone, body });
const LEGAL_DRAFT = notice('**Draft for legal review.** This text is a starting point written for PhysioCare. Have a lawyer review it before launch.');

const SERVICES = [
  ['home-physiotherapy', 'Physiotherapy at home', '🏠', 'A verified physiotherapist visits your home with the equipment needed. 45-minute sessions, a plan you can follow, and notes after every visit.'],
  ['post-surgery-rehab', 'After surgery (knee, hip, spine)', '🦵', 'Recovery after knee or hip replacement, ACL repair, fracture fixation or spine surgery, following your surgeon’s protocol.'],
  ['stroke-rehab', 'Stroke and neuro rehabilitation', '🧠', 'Help with walking, balance, arm and hand use after a stroke, Parkinson’s or other nerve conditions, with family training.'],
  ['back-neck-pain', 'Back and neck pain', '🧍', 'Slipped disc, sciatica, cervical spondylosis and posture pain: hands-on treatment and exercises you can continue at home.'],
  ['sports-injury', 'Sports injuries', '⚽', 'Sprains, ligament and muscle injuries, return-to-sport training for runners, cricketers and gym-goers.'],
  ['elderly-care', 'Elderly care and fall prevention', '👵', 'Strength, balance and mobility for older adults, safe walking, and fewer falls at home.'],
  ['video-consultation', 'Video consultation', '📱', 'Assessment and exercise review on a video call, for follow-ups or when a home visit isn’t possible.'],
];
const CONDITIONS = [
  ['knee-pain', 'Knee pain and arthritis'], ['frozen-shoulder', 'Frozen shoulder'], ['slipped-disc', 'Slipped disc and sciatica'],
  ['cervical-spondylosis', 'Cervical spondylosis'], ['paralysis', 'Paralysis after stroke'], ['parkinsons', 'Parkinson’s disease'],
  ['fracture-recovery', 'Recovery after a fracture'], ['plantar-fasciitis', 'Heel pain (plantar fasciitis)'],
];

export const STARTER_PAGES = [
  {
    slug: '', kind: 'page', title: 'Home', seo: { title: 'PhysioCare | Verified physiotherapy at home in Patna', description: 'Book a verified, background-checked physiotherapist at home in Patna. Female physios available. Pay by cash or UPI.' },
    blocks: [
      hero('Physiotherapy. At home. Near you.', 'Verified physiotherapists matched to your home, your recovery and your choice of therapist.', { badge: 'Now in Patna', ctaLabel: 'Find a physiotherapist', ctaHref: '/book', secondaryLabel: 'I have a doctor’s code', secondaryHref: '/signin' }),
      { id: id(), type: 'stats', items: [{ value: 'BPT / MPT', label: 'Qualified and council-registered' }, { value: '100%', label: 'Police-verified physios' }, { value: '45 min', label: 'Unhurried home sessions' }, { value: '24×7', label: 'Safety team during every visit' }] },
      cards('What we help with', SERVICES.slice(0, 6).map(([s, title, icon, body]) => ({ icon, title, body, href: `/services/${s}` }))),
      steps('How it works', [['Tell us about the problem', 'Sign in with your mobile number and choose home or video.'], ['Pick your physiotherapist', 'We show the best 3 near you. Prefer a woman physio? Just choose it.'], ['Pick a time and pay your way', 'Cash at the visit or UPI. You get a check-in code for safety.'], ['Recover with a plan', 'Notes and exercises after every session, and chat with your physio.']]),
      { id: id(), type: 'physios', heading: 'Physiotherapists near you', sub: 'Every physio is qualified, police-verified and trained in our safety rules.', limit: 6 },
      { id: id(), type: 'zones', heading: 'Where we visit in Patna', sub: 'We are adding areas every month.' },
      faq('Common questions', [
        ['How much does a session cost?', 'Each physiotherapist sets their price, shown before you book. Packages of 5 or 10 sessions cost less per visit.'],
        ['Can I ask for a woman physiotherapist?', 'Yes. Choose “female physio” when booking. A woman patient is never sent a male physio alone; a male physio visits only when an adult family member will be present, and both sides agree first.'],
        ['How do I pay?', 'Cash to your physio at the visit, or UPI by scanning our QR. You get a receipt in the app.'],
        ['What if I am not happy?', 'Report a problem from the booking within 7 days. Unused sessions in a package can be refunded. See [Refunds & cancellation](/legal/refunds).'],
      ]),
      cta('Start your recovery this week', 'Most patients in Patna get a visit within 24 hours.'),
    ],
  },
  {
    slug: 'services', kind: 'page', title: 'Services', summary: 'Physiotherapy at home and on video, for every stage of recovery.',
    blocks: [hero('Our services', 'Home visits by verified physiotherapists across Patna, and video sessions anywhere.'), { id: id(), type: 'pageList', heading: 'Choose a service', kind: 'service', limit: 20 }, cta('Not sure what you need?', 'Book an assessment. Your physio will suggest a plan.')],
  },
  ...SERVICES.map(([slug, title, icon, summary], i) => ({
    slug: `services/${slug}`, kind: 'service', title, summary, sortOrder: i, seo: { title: `${title} in Patna | PhysioCare`, description: summary },
    blocks: [hero(`${icon} ${title}`, summary, { ctaLabel: 'Book a session', ctaHref: '/book' }),
      text('**What happens in the first visit**\n\n- Your physio asks about the problem, your history and your goals\n- Assessment of movement, strength and pain\n- First treatment and a home exercise plan\n- A suggested number of sessions, with no pressure to buy a package', 'What to expect'),
      faq('Questions', [['How many sessions will I need?', 'It depends on the problem. Your physio will tell you after the first assessment and update the plan as you improve.'], ['Do I need a doctor’s prescription?', 'Not for most problems. After surgery, please keep your surgeon’s discharge summary ready for the physio.']]),
      cta('Book a verified physiotherapist', 'Female physios available.')],
  })),
  {
    slug: 'conditions', kind: 'page', title: 'Conditions we treat', summary: 'Common problems our physiotherapists treat at home.',
    blocks: [hero('Conditions we treat', 'From everyday pain to long-term rehabilitation.'), { id: id(), type: 'pageList', heading: 'Conditions', kind: 'condition', limit: 50 }],
  },
  ...CONDITIONS.map(([slug, title], i) => ({
    slug: `conditions/${slug}`, kind: 'condition', title, sortOrder: i, summary: `How physiotherapy at home helps with ${title.toLowerCase()}.`,
    seo: { title: `${title}: physiotherapy at home in Patna`, description: `Treatment for ${title.toLowerCase()} by verified physiotherapists at home in Patna.` },
    blocks: [hero(title, `Physiotherapy at home for ${title.toLowerCase()}, by verified physiotherapists.`, { ctaLabel: 'Book an assessment', ctaHref: '/book' }),
      text('Write about this condition here: common causes, signs, how physiotherapy helps, and when to see a doctor urgently.', 'About this condition'),
      notice('This page is general information, not medical advice. If you have sudden severe pain, weakness, numbness or loss of bladder control, see a doctor at once.', 'info'),
      cta('Talk to a physiotherapist', 'Home visits across Patna.')],
  })),
  {
    slug: 'how-it-works', kind: 'page', title: 'How it works',
    blocks: [hero('How PhysioCare works', 'Simple to book, safe at home, and clear about money.'),
      steps('Booking', [['Sign in', 'Only your mobile number. No password.'], ['Choose home or video', 'We check that your area is covered.'], ['Pick from the best 3', 'Matched on your problem, distance and your choice of a male or female physio.'], ['Choose a time and how to pay', 'Cash at the visit, or UPI by QR.']]),
      text('**Every visit is protected.**\n\n- You get a 4-digit check-in code; the physio can start only with it\n- Live location is shared with our safety team only during the visit\n- Our team is on call during every session\n- A male physio visits a woman patient only with an adult family member present, and only if both agree', 'Safety'),
      cta('Ready to book?', 'It takes about two minutes.')],
  },
  {
    slug: 'about', kind: 'page', title: 'About us',
    blocks: [hero('About PhysioCare', 'PhysioCare by Healthtropic brings qualified physiotherapists to homes in Bihar, starting in Patna.'),
      text('Write your story here: why PhysioCare started, the team, and your promise to patients and physiotherapists.', 'Our story'),
      { id: id(), type: 'grievance', heading: 'Grievance Officer' }],
  },
  {
    slug: 'faq', kind: 'page', title: 'Frequently asked questions',
    blocks: [hero('Questions and answers', 'Can’t find your answer? Call or WhatsApp us.'),
      faq('Booking', [['How soon can someone come?', 'Usually within 24 hours, at least 3 hours after you book.'], ['Can I choose the same physio every time?', 'Yes. A package keeps the same physio for all sessions.'], ['Can I reschedule?', 'Yes, free up to 3 hours before the visit.']]),
      faq('Safety', [['Are physios verified?', 'Every physio shows their degree and council registration, passes police verification and signs our safety agreement before their first visit.'], ['What is the check-in code?', 'A 4-digit code in your app on the visit day. Give it to the physio when they arrive; the visit starts only with it.']]),
      faq('Payments and refunds', [['How do I pay?', 'Cash at the visit or UPI by QR.'], ['What are coins?', '10 coins = ₹1. You get coins when you join with a friend’s or doctor’s link and when friends you invite book. Coins can pay up to 20% of a booking.'], ['Can I get a refund?', 'Unused sessions in a package can be refunded. See [Refunds & cancellation](/legal/refunds).']])],
  },
  {
    slug: 'patna', kind: 'city', title: 'Physiotherapy at home in Patna', summary: 'Areas we cover in Patna.',
    seo: { title: 'Physiotherapy at home in Patna | PhysioCare', description: 'Verified home physiotherapy in Kankarbagh, Rajendra Nagar, Patliputra, Bailey Road, Boring Road and more.' },
    blocks: [hero('Physiotherapy at home in Patna', 'Verified physiotherapists in your neighbourhood.', { ctaLabel: 'Check my area', ctaHref: '/book' }), { id: id(), type: 'zones', heading: 'Areas we cover' }, { id: id(), type: 'physios', heading: 'Physiotherapists in Patna', limit: 9 }],
  },
  {
    slug: 'join-as-physio', kind: 'page', title: 'Join as a physiotherapist',
    blocks: [hero('Work with PhysioCare', 'Steady home-visit bookings near you, weekly payouts, and a safety team behind every visit.', { ctaLabel: 'Get the physio app', ctaHref: '/join-as-physio#apply' }),
      cards('Why physios join', [{ icon: '📍', title: 'Visits near you', body: 'Set your area and radius; we keep travel short.' }, { icon: '💸', title: 'Paid every week', body: 'Earnings are clear per visit, paid to your bank or UPI.' }, { icon: '🛡️', title: 'Safe visits', body: 'Check-in codes, SOS and a 24×7 team.' }]),
      steps('How to join', [['Download the physio app', 'Sign in with your mobile number.'], ['Add your details and documents', 'Degree, council registration, ID, police verification, bank proof.'], ['Sign the partner agreement', 'In the app.'], ['Get verified', 'Our team reviews within 2 working days.']])],
  },
  { slug: 'blog', kind: 'page', title: 'Blog', blocks: [hero('Recovery tips and stories', 'Advice from our physiotherapists.'), { id: id(), type: 'pageList', heading: 'Latest', kind: 'blog', limit: 30 }] },
  {
    slug: 'legal/terms', kind: 'legal', title: 'Terms of use',
    blocks: [LEGAL_DRAFT, text('**1. About us.** PhysioCare is operated by Healthtropic (“we”). We connect patients with independent, verified physiotherapists for home and video sessions.\n\n**2. Not for emergencies.** PhysioCare is not an emergency service. In an emergency call 112.\n\n**3. Accounts.** You sign in with your mobile number and must give correct details. You are responsible for activity on your account.\n\n**4. Bookings.** A booking is confirmed when you choose a payment method. Times are in IST.\n\n**5. Payments.** You pay by cash at the visit or by UPI to PhysioCare. Prices are shown before you book.\n\n**6. Cancellations and refunds.** See [Refunds & cancellation](/legal/refunds).\n\n**7. Safety rules.** Check-in codes, the family-present rule for male physios visiting women patients, and our right to stop a visit for safety are part of these terms.\n\n**8. Conduct.** Abuse, harassment, sharing contact details to avoid the platform, or fraud can lead to your account being blocked.\n\n**9. Liability.** Physiotherapists are independent professionals responsible for their clinical care. Our liability is limited to the amount you paid for the affected session, to the extent the law allows.\n\n**10. Complaints.** See [Grievance Officer](/grievance).\n\n**11. Law.** These terms are governed by Indian law; courts in Patna, Bihar have jurisdiction.')],
  },
  {
    slug: 'legal/privacy', kind: 'legal', title: 'Privacy policy',
    blocks: [LEGAL_DRAFT, text('This policy explains how we handle personal data under the Digital Personal Data Protection Act, 2023.\n\n**What we collect.** Mobile number, name, age, gender, address and location (to match you with a physio), health details you share, session notes, payment references and screenshots, ratings and messages.\n\n**Why.** To book and run visits, keep visits safe, process payments and refunds, handle complaints, and meet legal duties.\n\n**Location.** A physio’s live location is collected only while they are on the way to or at a visit.\n\n**Who sees it.** Your physio sees what they need for your care. Our staff see data only for their role. We do not sell personal data.\n\n**How long.** As long as your account is active and as required by law (for example tax and medical records).\n\n**Your rights.** Access, correction, deletion and grievance. Write to our [Grievance Officer](/grievance).\n\n**Security.** Data is encrypted in transit; access is role-based and logged.')],
  },
  {
    slug: 'legal/refunds', kind: 'legal', title: 'Refunds and cancellation',
    blocks: [LEGAL_DRAFT, text('**Reschedule** free up to 3 hours before a visit.\n\n**Cancel** before the physio leaves: no charge. Late cancellation or no-show counts as a used session.\n\n**Packages:** unused sessions can be refunded pro rata on what you paid. Coins used come back as coins. Refunds are sent to your UPI ID or bank account within 7 working days of approval.\n\n**Problems with a visit:** report within 7 days from the booking. If upheld, we may refund the session.\n\n**Physio declines or doesn’t come:** the booking is cancelled at no cost and any payment is refunded.')],
  },
  {
    slug: 'legal/patient-consent', kind: 'legal', title: 'Patient consent',
    blocks: [LEGAL_DRAFT, text('By booking you agree that:\n\n- Physiotherapy involves physical assessment and treatment, which may cause temporary soreness\n- You have shared relevant medical history, surgeries and medicines\n- A male physiotherapist visits a woman patient only when a named adult family member is present, and both agree in advance\n- The physio may stop a session if it is unsafe\n- Session notes are kept in your record and visible to you\n- For a child under 18, a parent or guardian consents and stays present')],
  },
];
