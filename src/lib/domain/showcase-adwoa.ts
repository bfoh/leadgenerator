// One fictional coastal house, told through arrival, light, craft and an unhurried invitation.
// All house images are synthetic concept imagery. Categories, amenities and terms remain unconfirmed.
import type { EditorialCta, EditorialHero, EditorialIndex, WebsiteEditorial } from './website-editorial';

const stay = { kind: 'page' as const, label: 'Plan your stay', target: 'stay' };
const book = { kind: 'prototype' as const, label: 'Preview the booking enquiry', target: 'booking', note: 'Prototype only. No availability is checked, no details are collected and nothing is sent, held or charged.' };
const imageNote = 'Synthetic concept imagery · Not an actual property photograph.';
const roomNote = 'Room studies only. Room categories, facilities, rates and availability are unconfirmed.';
const cover = (eyebrow: string, lines: string[], lead: string, assetRole: EditorialHero['assetRole']): EditorialHero => ({
  kind: 'hero', variant: 'split-arrival', label: 'Page opening', eyebrow, lines, lead, assetRole,
  meta: [{ label: 'Place', value: 'Cape Coast, Ghana' }], primary: stay, note: imageNote,
});
const invitation = (title = 'A slower stay starts here.'): EditorialCta => ({
  kind: 'cta', variant: 'image-invitation', label: 'Invitation', assetRole: 'house', eyebrow: 'Make room for a little quiet', title,
  body: 'A few days, a good book, a different pace. Begin with a conversation about your stay.', primary: stay,
  secondary: { kind: 'page', label: 'Explore the house', target: 'house' }, note: 'Fictional guesthouse concept. No live bookings. Synthetic imagery.',
});
const roomRegister = (): EditorialIndex => ({
  kind: 'index', label: 'Rooms', title: 'Your own little world.', description: 'Nine rooms. An imagined feeling for each part of the house.', countLabel: '03 room studies / 09 rooms',
  entries: [
    { number: '01', title: 'Evening in the house', tag: 'Room study', meta: ['Soft light', 'Natural linen'], summary: 'The shutters open. The last of the day settles in.', assetRole: 'portrait' },
    { number: '02', title: 'Above the garden', tag: 'Room study', meta: ['Timber & shade', 'An upper-room idea'], summary: 'A quieter corner, framed by leaves and warm wood.', assetRole: 'scene' },
    { number: '03', title: 'The little details', tag: 'Material study', meta: ['Woven cloth', 'Made by hand'], summary: 'The grain of timber. The weight of linen. Small things, considered.', assetRole: 'detail' },
  ], note: roomNote,
});

export const ADWOA_EDITORIAL: WebsiteEditorial = {
  siteName: 'Adwoa’s House', monogram: 'AH', descriptor: 'A quiet house in Cape Coast, Ghana', action: stay,
  pages: [
    {
      slug: 'home', label: 'Home', title: 'Adwoa’s House — Arrive slowly', description: 'A fictional nine-room guesthouse in Cape Coast. A garden, a quiet room, a slower day.', tone: 'ink',
      sections: [
        {
          kind: 'hero', variant: 'immersive-arrival', label: 'Arrival', eyebrow: 'A quiet house / Cape Coast, Ghana', lines: ['Arrive', 'slowly.'],
          lead: 'Behind a garden wall, a different pace. Nine rooms. One small corner of Cape Coast.', assetRole: 'arrival', mobileAssetRole: 'arrival-mobile',
          meta: [{ label: 'Rooms', value: 'Nine' }], primary: stay, secondary: { kind: 'anchor', label: 'Discover the house', target: 'the-house' }, note: imageNote,
        },
        {
          kind: 'statement', variant: 'editorial-image', label: 'The house', title: 'Some places ask you to do less.',
          body: ['A quiet street. A walled garden. A house small enough to feel like a house.', 'The castle is a short walk away. For now, take a moment at the threshold.'], assetRole: 'threshold',
        },
        {
          kind: 'sequence', variant: 'scroll-story', label: 'The rhythm of the house', title: 'Let the day find its own rhythm.',
          items: [
            { assetRole: 'garden', title: 'Into the shade.', body: 'Past the gate, the garden takes over. A softer light. A little distance from the day.', caption: '01 / The garden, imagined.', emphasis: 'wide', focal: 'centre' },
            { assetRole: 'table', title: 'Nothing in a hurry.', body: 'Timber, clay and the changing light. A place to linger over the small things.', caption: '02 / A moment on the veranda.', emphasis: 'wide' },
            { assetRole: 'hero', title: 'Room to exhale.', body: 'Linen, open shutters, the garden just beyond. An imagined room for a slower stay.', caption: '03 / A garden-room study.', emphasis: 'wide' },
          ], note: 'One fictional house, imagined in light and texture. Synthetic concept imagery; facilities are not verified.',
        },
        roomRegister(),
        {
          kind: 'chapter', variant: 'image-story', label: 'Beyond the garden', number: 'CC', title: 'A house in Cape Coast.',
          body: ['Step outside and there is a different story. The house sits a short walk from Cape Coast Castle.', 'Make space for the place, its people and its history.'], assetRole: 'context',
          details: [{ label: 'The setting', value: 'Cape Coast, Ghana' }, { label: 'The castle', value: 'A short walk' }],
          note: 'Licensed photograph of Cape Coast Castle. It does not show the house or a view from it.',
        }, invitation(),
      ],
    },
    {
      slug: 'house', label: 'The House', title: 'The house — Adwoa’s House', description: 'Behind the wall, a quieter world. A fictional Cape Coast house in light and shade.', tone: 'ink',
      sections: [
        cover('The house / A little closer', ['Behind', 'the wall.'], 'Nine rooms, a walled garden, and the feeling of having arrived somewhere small.', 'arrival'),
        { kind: 'statement', variant: 'editorial-image', label: 'A warm welcome', title: 'The threshold is the beginning.', body: ['A garden between the street and your door. The shade of a veranda. The grain of timber under a hand.', 'The house is imagined through simple things, put together with care.'], assetRole: 'threshold' },
        { kind: 'sequence', variant: 'scroll-story', label: 'A sense of place', title: 'Built around the everyday.', items: [
          { assetRole: 'garden', title: 'Light through leaves.', body: 'A quiet courtyard holds the house together.', caption: 'The planted courtyard, imagined.', emphasis: 'wide' },
          { assetRole: 'detail', title: 'Made to be touched.', body: 'Woven cloth, natural linen and timber with a visible grain.', caption: 'An original material study.', emphasis: 'portrait' },
          { assetRole: 'table', title: 'Space to linger.', body: 'A simple table in the shade. Nothing more than the moment needs.', caption: 'Life on the veranda, imagined.', emphasis: 'wide' },
        ], note: 'Architecture and interiors are synthetic design proposals, not a survey of an existing property.' },
        { kind: 'chapter', variant: 'image-story', label: 'A room of your own', title: 'Let the outside in.', body: ['Shutters open to garden light. A room imagined with a few good materials and space to breathe.'], assetRole: 'hero', note: roomNote },
        invitation('Come in. Stay a while.'),
      ],
    },
    {
      slug: 'rooms', label: 'Rooms', title: 'The rooms — Adwoa’s House', description: 'Nine rooms, imagined through shade, timber and natural linen. Room studies, not verified categories.', tone: 'ink',
      sections: [
        cover('Nine rooms / Room studies', ['Room to', 'exhale.'], 'A little privacy. A softer light. Explore the imagined rooms of the house.', 'hero'),
        roomRegister(),
        { kind: 'gallery', variant: 'editorial-gallery', label: 'Look a little closer', title: 'Life around the room.', items: [
          { assetRole: 'threshold', title: 'The open threshold', caption: 'A room begins at its doorway.', emphasis: 'portrait' },
          { assetRole: 'table', title: 'A table in the shade', caption: 'The veranda, imagined in afternoon light.', emphasis: 'landscape' },
          { assetRole: 'garden', title: 'The courtyard', caption: 'A garden to return to.', emphasis: 'wide' },
        ], note: imageNote },
        { kind: 'details', label: 'Before your stay', title: 'A few things to ask.', body: 'The room studies express a design direction. Confirm the practical details before making a booking.', items: [
          { label: 'Room types & occupancy', value: 'To be confirmed', placeholder: true },
          { label: 'Rates & inclusions', value: 'Not published — to be confirmed', placeholder: true },
          { label: 'Access & cancellation', value: 'To be confirmed', placeholder: true },
        ], action: book },
        invitation('Find your quiet corner.'),
      ],
    },
    {
      slug: 'day', label: 'Slow Days', title: 'Slow days — Adwoa’s House', description: 'An imagined day in a small coastal house. Light, shade, a little time of your own.', tone: 'ink',
      sections: [
        cover('Slow days / In your own time', ['Less to do.', 'More to feel.'], 'The pleasure of a day without too much in it.', 'table'),
        { kind: 'sequence', variant: 'scroll-story', label: 'From first light to lamplight', title: 'Three moments. One unhurried day.', items: [
          { assetRole: 'threshold', title: 'The morning opens.', body: 'Light falls across the veranda. The garden is still in shade.', caption: 'Morning / A threshold study.', emphasis: 'portrait' },
          { assetRole: 'garden', title: 'Follow the shade.', body: 'A little time in the courtyard, with nowhere else to be.', caption: 'Afternoon / The courtyard, imagined.', emphasis: 'wide' },
          { assetRole: 'portrait', title: 'Let evening arrive.', body: 'Warm light, open shutters. The small ritual of returning to your room.', caption: 'Evening / An upper-room study.', emphasis: 'wide' },
        ], note: 'An imagined guest experience. No dining, spa, guided activity or other service is represented as verified.' },
        { kind: 'gallery', variant: 'editorial-gallery', label: 'The small things', title: 'A day, in details.', items: [
          { assetRole: 'detail', caption: 'Linen, timber, woven cloth.', emphasis: 'portrait' },
          { assetRole: 'hero', caption: 'A room held in garden light.', emphasis: 'wide' },
        ], note: imageNote },
        invitation('Make a little time.'),
      ],
    },
    {
      slug: 'cape-coast', label: 'Cape Coast', title: 'Cape Coast — Adwoa’s House', description: 'The house is a short walk from Cape Coast Castle. Location and arrival details need confirmation.', tone: 'ink',
      sections: [
        { ...cover('Beyond the house / Cape Coast', ['A place', 'with a story.'], 'A quiet house, a short walk from Cape Coast Castle.', 'context'), note: 'Licensed photograph of Cape Coast Castle, not the house or a view from it.' },
        { kind: 'statement', variant: 'editorial-image', label: 'At your own pace', title: 'A quieter way back.', body: ['Time outside the garden. Time to return to it.', 'The fictional house is set on a quiet street, a short walk from the castle. Exact directions and access details remain to be confirmed.'], assetRole: 'threshold' },
        { kind: 'gallery', variant: 'editorial-gallery', label: 'Back at the house', title: 'From the street to the shade.', items: [
          { assetRole: 'arrival', caption: 'The arrival, imagined.', emphasis: 'wide' },
          { assetRole: 'garden', caption: 'A quiet courtyard behind the wall.', emphasis: 'portrait' },
        ], note: 'Synthetic house imagery. It does not depict a real street, surveyed location or actual property.' },
        { kind: 'details', label: 'Finding the house', title: 'The last few details.', items: [
          { label: 'Place', value: 'Cape Coast, Ghana' }, { label: 'Address & directions', value: 'To be confirmed', placeholder: true }, { label: 'Arrival & access', value: 'Ask before travelling', placeholder: true },
        ], action: book }, invitation('A quiet place to return to.'),
      ],
    },
    {
      slug: 'stay', label: 'Your Stay', title: 'Your stay — Adwoa’s House', description: 'Explore the booking enquiry concept. No details are collected and no reservation is made.', tone: 'ink',
      sections: [
        { ...cover('Your stay / Begin a conversation', ['A few days,', 'just for you.'], 'Tell us when you have in mind. The rest begins with a conversation.', 'portrait'), primary: book },
        { kind: 'process', label: 'An easier beginning', title: 'A little planning. A lot less hurry.', steps: [
          { number: '01', title: 'Your dates.', body: 'Have your preferred dates and party size in mind.' },
          { number: '02', title: 'Your room.', body: 'Ask about room options, access and anything you need.' },
          { number: '03', title: 'The details.', body: 'Confirm rates, inclusions and cancellation terms directly.' },
        ], note: 'Booking journey concept only. No room is held and no enquiry is sent.' },
        { kind: 'chapter', variant: 'image-story', label: 'Before you arrive', title: 'Good stays start with clear details.', body: ['Room categories, prices, inclusions, access and booking terms are still to be confirmed.'], assetRole: 'garden', details: [{ label: 'Reservations', value: 'Prototype only' }, { label: 'Availability', value: 'Not connected' }], note: imageNote },
        { kind: 'cta', variant: 'image-invitation', label: 'The next step', eyebrow: 'Whenever you are ready', title: 'Shall we begin?', body: 'Preview how the enquiry will feel. This concept collects no personal details and sends no messages.', assetRole: 'house', primary: book, secondary: { kind: 'page', label: 'Revisit the rooms', target: 'rooms' }, note: 'Prototype only · No live booking · Synthetic concept imagery.' },
      ],
    },
  ],
  designNotes: [
    'First Light, refined as a continuous arrival → shade → material → room → coast → invitation narrative.',
    'Original owner-authorized synthetic imagery of one fictional property. One licensed castle context photograph.',
    'Native scroll-linked image wipes, explicit room controls, a keyboard gallery and an independent phone composition.',
    'Detailed evidence remains in the concept disclosure; unconfirmed categories and commercial details stay visible beside relevant studies.',
  ],
};
