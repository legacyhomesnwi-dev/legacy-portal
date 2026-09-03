// realFixtures.js
// Real Flexmls listing-alert email bodies (from listingupdates@flexmail.flexmls.com)
// captured 2026-09-03. The listing data — subject, price, address, MLS#, status,
// update type, flexmls URL — is left exactly as received, because that is what
// the parser is tested against. The agent signature block (name, brokerage,
// office address, email, phone, license #) has been replaced with placeholders.

const REAL_FIXTURES = [
  {
    label: 'New Listing — East Chicago',
    messageId: '1a067c212ae9ee91',
    subject: 'East Chicago Buy Box',
    sender: 'listingupdates@flexmail.flexmls.com',
    receivedAt: '2026-09-03T14:52:47Z',
    plaintextBody:
      'East Chicago Buy Box\n\nEast Chicago Buy Box\n\nNew Listing\n$98,000.00\n3721 Ivy Street, East Chicago, IN 46312\nActive - MLS #844744\n\nUpdate:\n\nFollow this link to view the listing in flexmls: https://www.flexmls.com/notifications.html?agent_id=20240103155345209176000000&newsfeed_id=20260402212326896670000000\n\nAgent Name\nBrokerage Name\n123 Main St, City, ST 00000\nagent@example.com\n555-000-0000\n\nLicense #: XXXXXXX',
  },
  {
    label: 'Back On Market — Crown Point',
    messageId: '1a068b010db0011e',
    subject: 'Mult - units',
    sender: 'listingupdates@flexmail.flexmls.com',
    receivedAt: '2026-09-03T19:12:43Z',
    plaintextBody:
      'Multi units on market\n\nBack On Market\n$259,900.00\n133 N Jackson Street, Crown Point, IN 46307\nActive - MLS #843555\n\nUpdate:\n\nFollow this link to view the listing in flexmls: https://www.flexmls.com/notifications.html?agent_id=20240103155345209176000000&newsfeed_id=20240228150710143142000000\n\nAgent Name\nBrokerage Name\n123 Main St, City, ST 00000\nagent@example.com\n555-000-0000\n\nLicense #: XXXXXXX',
  },
  {
    label: 'Price Change (early) — Gary, MLS 837383, $113,500',
    messageId: '1a04044878157c72',
    subject: 'Gary Buy Box',
    sender: 'listingupdates@flexmail.flexmls.com',
    receivedAt: '2026-08-26T22:50:27Z',
    plaintextBody:
      'Gary Buy Box\n\nGary Buy Box\n\nPrice Change\n$113,500.00\n4173 Jackson Street, Gary, IN 46408\nActive - MLS #837383\n\nUpdate:\n\nFollow this link to view the listing in flexmls: https://www.flexmls.com/notifications.html?agent_id=20240103155345209176000000&newsfeed_id=20260402152445894664000000\n\nAgent Name\nBrokerage Name\n123 Main St, City, ST 00000\nagent@example.com\n555-000-0000\n\nLicense #: XXXXXXX',
  },
  {
    label: 'Price Change (later, SAME MLS#) — Gary, MLS 837383, $111,750',
    messageId: '1a0685d0e7d34e9d',
    subject: 'Gary Buy Box',
    sender: 'listingupdates@flexmail.flexmls.com',
    receivedAt: '2026-09-03T17:42:03Z',
    plaintextBody:
      'Gary Buy Box\n\nGary Buy Box\n\nPrice Change\n$111,750.00\n4173 Jackson Street, Gary, IN 46408\nActive - MLS #837383\n\nUpdate:\n\nFollow this link to view the listing in flexmls: https://www.flexmls.com/notifications.html?agent_id=20240103155345209176000000&newsfeed_id=20260402152445894664000000\n\nAgent Name\nBrokerage Name\n123 Main St, City, ST 00000\nagent@example.com\n555-000-0000\n\nLicense #: XXXXXXX',
  },
];

module.exports = { REAL_FIXTURES };
