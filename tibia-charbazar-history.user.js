// ==UserScript==
// @name Tibia Charbazar Auctions History
// @namespace ziirgg
// @description This script improves Tibia.com Charbazar Auctions History with additional filters.
// @icon  https://www.tibia.com/favicon.ico
// @match https://www.tibia.com/charactertrade/*subtopic=pastcharactertrades*
// @run-at document-end
// @version 1.0.0
// ==/UserScript==

const AUCTION_CONTAINER_SELECTOR = '.Auction';
const AUCTION_HEADER_SELECTOR = '.AuctionHeader';
const AUCTION_CHARACTER_NAME_LINK_SELECTOR = '.AuctionCharacterName a';
const AUCTION_CHARACTER_WORLD_LINK_SELECTOR = 'a[href*=worlds]';
const AUCTION_DETAILS_LINK_SELECTOR = 'a[href*=auctionid]';
const AUCTION_WINNING_BID_SELECTOR = '.ShortAuctionDataValue b';
const AUCTION_DATES_SELECTOR = '.ShortAuctionDataValue';
const RESULTS_ADJACENT_NODE_SELECTOR = '.InnerTableContainer table tbody';
const FILTERS_CONTAINER_SELECTOR = '.HintBox';

const DEFAULT_NUMBER_OF_PAGES = 10;
const DEFAULT_CONCURRENT_WORKERS = 2;

const ORIGIN = 'https://www.tibia.com';
const BASE_PATH = '/charactertrade/?subtopic=pastcharactertrades';
const PAGE_PARAM_NAME = 'currentpage';

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

const FIELDS = [
  {
    label: 'Number Of Pages',
    name: 'numberOfPages',
    defaultValue: DEFAULT_NUMBER_OF_PAGES,
    placeholder: DEFAULT_NUMBER_OF_PAGES,
  },
  {
    label: 'Number Of Workers',
    name: 'numberOfWorkers',
    defaultValue: DEFAULT_CONCURRENT_WORKERS,
    placeholder: DEFAULT_CONCURRENT_WORKERS,
  },
  { label: 'Minimum Level', name: 'minLevel', placeholder: '8' },
  { label: 'Maximum Level', name: 'maxLevel', placeholder: '100' },
  { label: 'World', name: 'world', placeholder: 'Adra' },
  { label: 'Vocation', name: 'vocation', placeholder: 'Sorcerer' },
];

function processAuctionNode(node) {
  const row =
    node.parentNode.parentNode.parentNode.parentNode.parentNode.parentNode
      .parentNode.parentNode;

  const header = node.querySelector(AUCTION_HEADER_SELECTOR);

  const name = header.querySelector(AUCTION_CHARACTER_NAME_LINK_SELECTOR)
    .innerText;

  const summary = Array.from(header.childNodes).find(
    (child) => child.nodeType === Node.TEXT_NODE
  ).textContent;

  let [level, vocation, gender] = summary
    .split(' | ')
    .map((str) => str.split(': ').pop());
  level = Number.parseInt(level, 10);
  const world = header.querySelector(AUCTION_CHARACTER_WORLD_LINK_SELECTOR)
    .textContent;

  const bidContainer = node.querySelector(AUCTION_WINNING_BID_SELECTOR);
  const bid =
    (bidContainer &&
      Number.parseInt(bidContainer.textContent.replace(',', ''))) ||
    Number.NaN;

  const details = node.querySelector(AUCTION_DETAILS_LINK_SELECTOR).href;

  const [start, end] = Array.from(node.querySelectorAll(AUCTION_DATES_SELECTOR))
    .slice(0, 2)
    .map(({ textContent }) => {
      let [date, time] = textContent.split(',');
      let [month, day, year] = date.split(date.split('')[3]);
      month = MONTHS.indexOf(month);
      const hour = time.trim().split(':')[0];
      return new Date(year, month, day, hour);
    });

  return {
    name,
    level,
    vocation,
    gender,
    world,
    bid,
    start,
    end,
    details,
    node,
    row,
  };
}

function processDocument(doc) {
  console.log('Processing document...');
  const auctionNodes = Array.from(
    doc.querySelectorAll(AUCTION_CONTAINER_SELECTOR)
  );

  return auctionNodes.map(processAuctionNode);
}

const worker = (next_, results, fn) => async () => {
  let next;
  while ((next = next_())) {
    const result = await fn(next);
    results.push(result);
  }
};

function fetchAndParseHTML(url) {
  console.log('Fetching page...');
  return fetch(url)
    .then((res) => res.text())
    .then((html) => new DOMParser().parseFromString(html, 'text/html'))
    .catch((err) => console.error(err));
}

let auctions = null;
let adjacentNode = null;
let resultsContainer = null;
async function handleFiltersFiltersFormSubmit(evt) {
  evt.preventDefault();
  const form = evt.target;
  const button = form.querySelector('button');
  button.setAttribute('disabled', true);

  const params = {};
  for (let [key, value] of new FormData(form)) {
    params[key] = value;
  }

  const { numberOfPages, numberOfWorkers } = params;

  const pages = Array.from(
    new Array(Number.parseInt(numberOfPages)),
    (_, i) => `${ORIGIN}${BASE_PATH}&${PAGE_PARAM_NAME}=${i + 1}`
  );

  let documents = [];
  const workers = [];
  console.log(
    `Preparing ${numberOfWorkers} workers, to fetch & parse ${pages.length} pages.`
  );
  for (let i = 0; i < Number.parseInt(numberOfWorkers); i++) {
    workers.push(worker(pages.pop.bind(pages), documents, fetchAndParseHTML)());
  }
  await Promise.all(workers);
  console.log(`Workers are finished.`);
  auctions = documents.reduce((acc, doc) => {
    let pageAuctions;
    try {
      pageAuctions = processDocument(doc);
    } catch (err) {
      console.error(err);
      // pass
    }
    if (pageAuctions) acc.push.apply(acc, pageAuctions);
    return acc;
  }, []);
  console.log(`Extracted ${auctions.length} auctions.`);

  const { world, minLevel, maxLevel, vocation } = params;

  const filtered = auctions
    .filter((auction) => !world || auction.world === world)
    .filter(
      (auction) => !vocation || new RegExp(vocation, 'i').test(auction.vocation)
    )
    .filter(
      (auction) =>
        minLevel === '' || auction.level >= Number.parseInt(minLevel, 10)
    )
    .filter(
      (auction) =>
        maxLevel === '' || auction.level <= Number.parseInt(maxLevel, 10)
    );

  console.log(`Filtered ${filtered.length} auctions`);

  try {
    adjacentNode =
      adjacentNode || document.querySelector(RESULTS_ADJACENT_NODE_SELECTOR);
    const results = filtered
      .map((auction) => auction.row)
      .reduce((acc, row) => {
        acc += row.outerHTML;
        return acc;
      }, '');
    resultsContainer = resultsContainer || adjacentNode.parentElement;
    resultsContainer.innerHTML = results;
    if (!results.length) {
      const noResults = document.createElement('p');
      noResults.innerHTML = `
        No results for your filtering criterias.
        <br />
        You can try to perform the filtering on a higher number of pages.
        <br />
        Example:
        <br />
        - <strong>Number Of Pages</strong> = 100
        <br />
        - <strong>Number Of Workers</strong> = 10
        <br />
        Notes:
        <br />
        - The higher the number of pages, the longer filtering results will take.
        <br />
        - A higher number of workers means more results pages will be processed concurently.
      `;
      resultsContainer.appendChild(noResults);
    }

    button.removeAttribute('disabled');
  } catch (err) {
    console.error(err);
  }
}

let filtersContainer = document.querySelector(FILTERS_CONTAINER_SELECTOR);
filtersContainer.outerHTML =
  '<div class="HintBox" style="text-align: right;"></div>';
filtersContainer = document.querySelector(FILTERS_CONTAINER_SELECTOR);
const filtersForm = document.createElement('form');

FIELDS.forEach(({ label, name, defaultValue, placeholder }) => {
  const field = document.createElement('div');
  field.style =
    'display: flex; justify-content: space-between; align-items: center;';

  const input = document.createElement('input');
  input.name = name;
  input.placeholder = placeholder;
  input.id = `charbazar-history-${name}`;
  input.value = defaultValue || '';

  const labelEl = document.createElement('label');
  labelEl.textContent = label || name;
  labelEl.setAttribute('for', input.id);

  field.append(labelEl, input);
  filtersForm.appendChild(field);
});
const submitButton = document.createElement('button');
submitButton.textContent = 'Filter';
filtersForm.appendChild(submitButton);
filtersContainer.appendChild(filtersForm);

filtersForm.addEventListener('submit', handleFiltersFiltersFormSubmit);
