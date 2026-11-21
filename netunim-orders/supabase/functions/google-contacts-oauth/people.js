const sources = {
  contacts: 'people:searchContacts',
  other: 'otherContacts:search',
};

export function peopleSearchUrl(source, query) {
  const url = new URL(`https://people.googleapis.com/v1/${sources[source]}`);
  url.search = new URLSearchParams({query, readMask: 'names,emailAddresses', pageSize: query ? '20' : '1'}).toString();
  return url.toString();
}

function text(value) { return typeof value === 'string' ? value.trim() : ''; }
function items(value) { return Array.isArray(value) ? value : []; }

export function searchRows(source, data) {
  // The provider may omit the repeated results field when there are no matches.
  if (data.results !== undefined && !Array.isArray(data.results)) throw new Error('invalid_people_response');
  return items(data.results).flatMap(({person} = {}) => {
    const names = items(person?.names);
    const name = text((names.find(item => item?.metadata?.primary === true) || names[0])?.displayName).slice(0, 160);
    return items(person?.emailAddresses).flatMap(entry => {
      const email = text(entry?.value);
      return email.length <= 180 && /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/u.test(email)
        ? [{name, email, sources: [source]}] : [];
    });
  });
}

export function mergeSearchRows(groups, query) {
  const byAddress = new Map();
  for (const row of groups.flat()) {
    const key = row.email.toLowerCase(), prior = byAddress.get(key);
    if (!prior) byAddress.set(key, row);
    else byAddress.set(key, {...prior, name: prior.name || row.name, sources: [...new Set([...prior.sources, ...row.sources])]});
  }
  const term = query.toLowerCase();
  const rank = row => row.email.toLowerCase() === term ? 0 : row.name.toLowerCase() === term ? 1 : row.sources.includes('contacts') ? 2 : 3;
  return [...byAddress.values()].sort((a, b) => rank(a) - rank(b));
}
