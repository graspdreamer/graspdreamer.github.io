import { exampleGroups } from './examples.js';
import { graspPairs } from './grasp-pairs.js';
import { createTurntable, renderUrl } from './turntable.js?v=canopy-hd-v2';

const picker = document.querySelector('#object');
const stage = document.querySelector('#stage');
const canvas = document.querySelector('#turntable');
const poster = document.querySelector('#poster');
const guide = document.querySelector('#view-guide');
const promptOptions = document.querySelector('#prompt-options');
const objects = new Map(graspPairs.map(object => [object.id, object]));
// The saved arrays use I, M, P, R, T; the table labels use I, M, R, P, T.
const displayFingerOrder = [0, 1, 3, 2, 4];


let showTurntable;
try {
  showTurntable = createTurntable(stage, canvas, poster, guide, {
    slider: document.querySelector('#view-angle'),
    angleOutput: document.querySelector('#view-angle-value'),
  });
  document.querySelector('#camera-controls').hidden = false;
} catch {
  showTurntable = () => { guide.textContent = 'Showing a still view.'; };
}

function highlightedPrompt(text) {
  const fragment = document.createDocumentFragment();
  // Preserve every character of the recorded instruction while emphasizing its controls.
  const controls = /mostly straight|partly bent|more bent|bent|straight|extended|index|middle|ring|pinky|thumb|little finger/gi;
  let offset = 0;
  for (const match of text.matchAll(controls)) {
    fragment.append(document.createTextNode(text.slice(offset, match.index)));
    const strong = document.createElement('strong');
    strong.textContent = match[0];
    fragment.append(strong);
    offset = match.index + match[0].length;
  }
  fragment.append(document.createTextNode(text.slice(offset)));
  return fragment;
}

let selectedObject;
function showCase(caseIndex) {
  const example = selectedObject.cases[caseIndex];
  const letter = caseIndex === 0 ? 'A' : 'B';
  poster.src = renderUrl(example.poster);
  poster.alt = `Recorded static grasp of ${selectedObject.name.toLowerCase()}, instruction ${letter}.`;
  document.querySelector('#view-label').textContent = `${selectedObject.name} · ${letter}`;
  canvas.setAttribute('aria-label', `Rotate the camera around ${selectedObject.name}, instruction ${letter}, and zoom`);
  for (const [index, button] of [...promptOptions.children].entries()) {
    button.setAttribute('aria-pressed', String(index === caseIndex));
  }
  const tbody = document.querySelector('#finger-table tbody');
  tbody.replaceChildren();
  for (const [label, key] of [['Planner', 'plannerBins'], ['Measured', 'actualBins']]) {
    const row = document.createElement('tr');
    const heading = document.createElement('th');
    heading.scope = 'row';
    heading.textContent = label;
    row.append(heading);
    for (const fingerIndex of displayFingerOrder) {
      const cell = document.createElement('td');
      cell.textContent = example[key][fingerIndex];
      if (example[key][fingerIndex] !== selectedObject.cases[1 - caseIndex][key][fingerIndex]) cell.className = 'changed';
      if (key === 'actualBins') cell.title = `${example.actualAnglesDeg[fingerIndex].toFixed(1)}°`;
      row.append(cell);
    }
    tbody.append(row);
  }
  document.querySelectorAll('.gallery-card').forEach(card => {
    card.setAttribute('aria-pressed', String(card.dataset.object === selectedObject.id && Number(card.dataset.case) === caseIndex));
  });
  showTurntable({ ...example, azimuth: selectedObject.azimuth, elevation: selectedObject.elevation });
}

function showObject(id, caseIndex = 0) {
  selectedObject = objects.get(id);
  picker.value = id;
  document.querySelector('#object-name').textContent = selectedObject.name;
  promptOptions.replaceChildren();
  selectedObject.cases.forEach((example, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'prompt-choice';
    button.setAttribute('aria-pressed', 'false');
    button.setAttribute('aria-controls', 'stage finger-table');
    const label = document.createElement('span');
    label.className = 'choice-label';
    label.textContent = `Instruction ${index === 0 ? 'A' : 'B'}`;
    const quote = document.createElement('span');
    quote.className = 'prompt-text';
    quote.append(highlightedPrompt(example.instruction));
    button.append(label, quote);
    button.addEventListener('click', () => showCase(index));
    promptOptions.append(button);
  });
  showCase(caseIndex);
}

// Put familiar contrasting objects first; every object remains available in the picker.
const featuredOrder = ['hammer', 'banana', 'mug', 'toothpaste', 'mouse', 'airplane'];
const orderedObjects = [...graspPairs].sort((a, b) => {
  const rank = id => featuredOrder.includes(id) ? featuredOrder.indexOf(id) : featuredOrder.length + graspPairs.findIndex(object => object.id === id);
  return rank(a.id) - rank(b.id);
});
orderedObjects.forEach(object => picker.append(new Option(object.name, object.id)));

const gallery = document.querySelector('#gallery');
for (let rowIndex = 0; rowIndex < 3; rowIndex++) {
  const row = document.createElement('div');
  row.className = 'gallery-row';
  row.setAttribute('aria-label', `Grasp collection row ${rowIndex + 1}`);
  orderedObjects.slice(rowIndex * 7, rowIndex * 7 + 7).forEach(object => {
    object.cases.forEach((example, index) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'gallery-card';
      card.dataset.object = object.id;
      card.dataset.case = index;
      card.setAttribute('aria-label', `${object.name}, instruction ${index === 0 ? 'A' : 'B'}`);
      card.setAttribute('aria-pressed', 'false');
      const img = document.createElement('img');
      img.src = renderUrl(example.poster);
      img.alt = '';
      img.width = 166;
      img.height = 166;
      img.loading = 'lazy';
      const caption = document.createElement('span');
      caption.append(document.createTextNode(object.name));
      const letter = document.createElement('b');
      letter.textContent = index === 0 ? 'A' : 'B';
      caption.append(letter);
      card.append(img, caption);
      card.addEventListener('click', () => {
        showObject(object.id, index);
        document.querySelector('#examples').scrollIntoView({ block: 'start' });
        promptOptions.children[index].focus({ preventScroll: true });
      });
      row.append(card);
    });
  });
  gallery.append(row);
}

for (const example of exampleGroups[0].examples) {
  const article = document.createElement('article');
  article.className = 'annotation-example';
  const img = document.createElement('img');
  img.src = renderUrl(`assets/reference-${example.id}.webp`);
  img.alt = example.alt;
  img.width = 768;
  img.height = 768;
  img.loading = 'lazy';
  const content = document.createElement('div');
  const title = document.createElement('h3');
  title.textContent = example.name;
  const dl = document.createElement('dl');
  for (const [label, prompt] of Object.entries(example.prompts)) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.append(highlightedPrompt(prompt));
    dl.append(dt, dd);
  }
  content.append(title, dl);
  article.append(img, content);
  document.querySelector('#annotation-examples').append(article);
}

picker.addEventListener('change', () => showObject(picker.value));
document.querySelector('#object-picker').hidden = false;
showObject('hammer');

import('./hero.js?v=canopy-hd-v2').then(({ createHeroCanopy }) => {
  createHeroCanopy(document.querySelector('#hero-canopy'), {
    motionButton: document.querySelector('#canopy-motion'),
  });
}).catch(() => { /* The recorded-grasp viewer remains usable without the decorative canopy. */ });
